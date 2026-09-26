// A Space is one group or DM: an encrypted Autobase whose apply() enforces
// membership and roles deterministically on every peer.
const Autobase = require('autobase')
const BlindPairing = require('blind-pairing')
const HyperDB = require('hyperdb')
const Hyperblobs = require('hyperblobs')
const ReadyResource = require('ready-resource')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const z32 = require('z32')
const c = require('compact-encoding')

const Dispatch = require('../spec/dispatch')
const DB = require('../spec/db')

const KIND_GROUP = 0
const KIND_DM = 1
const ROLE_MEMBER = 0
const ROLE_ADMIN = 1
const ROLE_OWNER = 2
const CHANNEL_TEXT = 0
const CHANNEL_VOICE = 1

const MAX_TEXT = 4000
const MAX_NAME = 32
const MAX_FILES = 10
const JOIN_TIMEOUT = 10 * 60 * 1000

const JoinRequest = {
  preencode (state, m) {
    c.fixed32.preencode(state, m.writer)
    c.fixed32.preencode(state, m.identity)
    c.fixed64.preencode(state, m.signature)
    c.string.preencode(state, m.name)
  },
  encode (state, m) {
    c.fixed32.encode(state, m.writer)
    c.fixed32.encode(state, m.identity)
    c.fixed64.encode(state, m.signature)
    c.string.encode(state, m.name)
  },
  decode (state) {
    return {
      writer: c.fixed32.decode(state),
      identity: c.fixed32.decode(state),
      signature: c.fixed64.decode(state),
      name: c.string.decode(state)
    }
  }
}

class Space extends ReadyResource {
  /**
   * @param {object} opts
   * @param {import('corestore')} opts.store namespaced store for this space
   * @param {BlindPairing} opts.pairing shared pairing instance
   * @param {import('hyperswarm')} opts.swarm
   * @param {{ publicKey: Buffer, secretKey: Buffer }} opts.identity
   * @param {string} opts.profileName
   * @param {Buffer} [opts.key] existing base key
   * @param {Buffer} [opts.encryptionKey]
   * @param {string} [opts.invite] z32 invite to join with
   * @param {{ name: string, kind: number }} [opts.create] create a new space
   */
  constructor (opts) {
    super()
    this.store = opts.store
    this.pairing = opts.pairing
    this.swarm = opts.swarm
    this.identity = opts.identity
    this.profileName = opts.profileName
    this.key = opts.key || null
    this.encryptionKey = opts.encryptionKey || null
    this.invite = opts.invite || null
    this.createOpts = opts.create || null
    this.blindEncryption = opts.blindEncryption || null

    this.base = null
    this.blobs = null
    this.candidate = null
    this.pairMember = null
    this._remoteBlobs = new Map()
    this._abortWait = null
    this._invites = new Map() // code -> invite id, for revocation

    this.router = new Dispatch.Router()
    this._setupRouter()
  }

  get view () {
    return this.base.view
  }

  get discoveryKey () {
    return this.base.discoveryKey
  }

  get id () {
    return b4a.toString(this.base.key, 'hex')
  }

  async _open () {
    if (this.invite && !this.key) await this._pair()

    this.base = new Autobase(this.store, this.key, {
      encrypt: true,
      encryptionKey: this.encryptionKey,
      blindEncryption: this.blindEncryption,
      ackInterval: 1000,
      open: (store) => HyperDB.bee(store.get('view'), DB, { extension: false, autoUpdate: true }),
      close: (view) => view.close(),
      apply: this._apply.bind(this)
    })
    this.base.on('update', () => {
      if (!this.base._interrupting) this.emit('update')
    })
    this.base.on('error', (err) => this.emit('warning', err))
    await this.base.ready()

    this.key = this.base.key
    this.encryptionKey = this.base.encryptionKey
    if (this.blindEncryption) await this._dropPlainKeyCopy()
    this.topic = this.swarm.join(this.base.discoveryKey)

    const blobKey = crypto.hash([this.encryptionKey, b4a.from('p2pcord/blobs')])
    this._blobEncryption = { key: blobKey }
    const blobCore = this.store.get({ name: 'blobs', encryption: this._blobEncryption })
    this.blobs = new Hyperblobs(blobCore)
    await this.blobs.ready()

    if (this.createOpts && this.base.writable && this.base.length === 0) {
      await this._bootstrap(this.createOpts)
    }

    // Only a fresh join waits to be added as writer; an existing space we were
    // removed from opens read-only (the app then reports it as removed)
    if (!this.base.writable && this.invite) {
      await new Promise((resolve, reject) => {
        const check = () => {
          if (!this.base.writable) return
          this.base.off('update', check)
          this._abortWait = null
          resolve()
        }
        this._abortWait = () => {
          this.base.off('update', check)
          reject(new Error('ABORTED'))
        }
        this.base.on('update', check)
        check()
      })
    }

    this.view.core.download({ start: 0, end: -1 })

    if (!this.base.writable) return

    this.pairMember = this.pairing.addMember({
      discoveryKey: this.base.discoveryKey,
      onadd: (request) => this._onPairRequest(request)
    })
  }

  // Older Autobase versions also kept the group key in plain text next to the
  // bootstrap core; with blind encryption active that copy must go.
  async _dropPlainKeyCopy () {
    const boot = this.store.get({ key: this.base.key, active: false })
    await boot.ready()
    if (await boot.getUserData('autobase/encryption')) await boot.setUserData('autobase/encryption', null)
    await boot.close()
  }

  close () {
    if (this._abortWait) this._abortWait()
    return super.close()
  }

  async _close () {
    if (this.candidate) await this.candidate.close()
    if (this.pairMember) await this.pairMember.close()
    if (this.topic) await this.swarm.leave(this.base.discoveryKey)
    for (const blobs of this._remoteBlobs.values()) await blobs.core.close()
    if (this.blobs) await this.blobs.core.close()
    if (this.base) await this.base.close()
  }

  async _pair () {
    const local = Autobase.getLocalCore(this.store)
    await local.ready()
    const writer = local.key
    await local.close()

    const userData = c.encode(JoinRequest, {
      writer,
      identity: this.identity.publicKey,
      signature: crypto.sign(writer, this.identity.secretKey),
      name: this.profileName
    })

    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('JOIN_TIMEOUT')), JOIN_TIMEOUT)
      this.candidate = this.pairing.addCandidate({
        invite: z32.decode(this.invite),
        userData,
        onadd: (result) => {
          clearTimeout(timer)
          resolve(result)
        }
      })
      this.candidate.request.once('rejected', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      this._abortWait = () => {
        clearTimeout(timer)
        reject(new Error('ABORTED'))
      }
    }).finally(async () => {
      this._abortWait = null
      const candidate = this.candidate
      this.candidate = null
      if (candidate) await candidate.close()
    })

    this.key = res.key
    this.encryptionKey = res.encryptionKey
  }

  async _bootstrap ({ name, kind }) {
    const writer = this.base.local.key
    await this._append('@p2pcord/add-member', {
      writer,
      identity: this.identity.publicKey,
      signature: crypto.sign(writer, this.identity.secretKey),
      name: this.profileName,
      role: ROLE_OWNER,
      joined: Date.now()
    })
    await this._append('@p2pcord/set-info', { id: 'info', name, kind, created: Date.now() })
    await this._append('@p2pcord/add-channel', {
      id: randomId(),
      name: kind === KIND_DM ? 'chat' : 'allgemein',
      kind: CHANNEL_TEXT,
      position: 0
    })
    await this._append('@p2pcord/add-channel', {
      id: randomId(),
      name: kind === KIND_DM ? 'anruf' : 'Lobby',
      kind: CHANNEL_VOICE,
      position: 1
    })
  }

  // Runs on every peer in the same order; must only depend on the view and the node.
  async _apply (nodes, view, host) {
    for (const node of nodes) {
      if (node.value === null) continue // ack
      try {
        await this.router.dispatch(node.value, { view, host, from: node.from.key })
      } catch (err) {
        this.emit('warning', err) // skip invalid ops, never halt the base
      }
    }
    await view.flush()
  }

  _setupRouter () {
    const r = this.router

    r.add('@p2pcord/add-member', async (m, { view, host, from }) => {
      if (!crypto.verify(m.writer, m.signature, m.identity)) return
      if (await view.get('@p2pcord/members', { writer: m.writer })) return

      const members = await view.find('@p2pcord/members', {}).toArray()
      if (members.length === 0) {
        // Bootstrap: only the creator's own writer can add itself as owner
        if (!b4a.equals(from, m.writer)) return
        await view.insert('@p2pcord/members', { ...m, role: ROLE_OWNER })
        return
      }

      const author = members.find((x) => b4a.equals(x.writer, from))
      if (!author) return

      const info = await view.get('@p2pcord/info', { id: 'info' })
      const sameIdentity = members.filter((x) => b4a.equals(x.identity, m.identity))
      if (info && info.kind === KIND_DM && sameIdentity.length === 0) {
        const identities = new Set(members.map((x) => b4a.toString(x.identity, 'hex')))
        if (identities.size >= 2) return
      }

      // A second device of an existing identity keeps that identity's role
      const role = sameIdentity.reduce((max, x) => Math.max(max, x.role), ROLE_MEMBER)
      const isDm = info && info.kind === KIND_DM
      await view.insert('@p2pcord/members', { ...m, name: clip(m.name, MAX_NAME), role })
      await host.addWriter(m.writer, { indexer: isDm || role >= ROLE_ADMIN })
    })

    r.add('@p2pcord/remove-member', async ({ writer }, { view, host, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      const target = await view.get('@p2pcord/members', { writer })
      if (!author || !target) return
      const self = b4a.equals(author.identity, target.identity)
      if (!self && !(author.role >= ROLE_ADMIN && target.role < author.role)) return
      await view.delete('@p2pcord/members', { writer })
      if (host.removeable(writer)) await host.removeWriter(writer)
    })

    r.add('@p2pcord/set-role', async ({ writer, role }, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      const target = await view.get('@p2pcord/members', { writer })
      if (!author || !target || author.role !== ROLE_OWNER) return
      if (role !== ROLE_MEMBER && role !== ROLE_ADMIN) return
      if (target.role === ROLE_OWNER) return
      const all = await view.find('@p2pcord/members', {}).toArray()
      for (const m of all) {
        if (b4a.equals(m.identity, target.identity)) await view.insert('@p2pcord/members', { ...m, role })
      }
    })

    r.add('@p2pcord/set-name', async ({ name }, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      if (!author) return
      const all = await view.find('@p2pcord/members', {}).toArray()
      for (const m of all) {
        if (b4a.equals(m.identity, author.identity)) {
          await view.insert('@p2pcord/members', { ...m, name: clip(name, MAX_NAME) })
        }
      }
    })

    r.add('@p2pcord/set-info', async (info, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      if (!author || author.role < ROLE_ADMIN) return
      const existing = await view.get('@p2pcord/info', { id: 'info' })
      await view.insert('@p2pcord/info', {
        id: 'info',
        name: clip(info.name, MAX_NAME),
        kind: existing ? existing.kind : info.kind,
        created: existing ? existing.created : info.created
      })
    })

    r.add('@p2pcord/add-channel', async (ch, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      if (!author || author.role < ROLE_ADMIN) return
      if (ch.kind !== CHANNEL_TEXT && ch.kind !== CHANNEL_VOICE) return
      await view.insert('@p2pcord/channels', { ...ch, name: clip(ch.name, MAX_NAME) })
    })

    r.add('@p2pcord/remove-channel', async ({ id }, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      if (!author || author.role < ROLE_ADMIN) return
      await view.delete('@p2pcord/channels', { id })
    })

    r.add('@p2pcord/add-invite', async (inv, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      if (!author) return
      await view.insert('@p2pcord/invites', { ...inv, uses: 0, createdBy: author.identity })
    })

    r.add('@p2pcord/use-invite', async ({ id }, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      const inv = await view.get('@p2pcord/invites', { id })
      if (!author || !inv) return
      const uses = inv.uses + 1
      if (inv.maxUses !== 0 && uses >= inv.maxUses) await view.delete('@p2pcord/invites', { id })
      else await view.insert('@p2pcord/invites', { ...inv, uses })
    })

    r.add('@p2pcord/remove-invite', async ({ id }, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      const inv = await view.get('@p2pcord/invites', { id })
      if (!author || !inv) return
      if (author.role < ROLE_ADMIN && !b4a.equals(author.identity, inv.createdBy)) return
      await view.delete('@p2pcord/invites', { id })
    })

    r.add('@p2pcord/add-message', async (msg, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      if (!author) return
      const channel = await view.get('@p2pcord/channels', { id: msg.channel })
      if (!channel) return
      if (await view.get('@p2pcord/messages', { channel: msg.channel, id: msg.id })) return
      const files = (msg.files || []).slice(0, MAX_FILES)
      if (!msg.text && files.length === 0) return
      await view.insert('@p2pcord/messages', {
        channel: msg.channel,
        id: msg.id,
        author: author.identity,
        text: clip(msg.text, MAX_TEXT),
        ts: msg.ts,
        files,
        replyTo: msg.replyTo || null,
        edited: 0
      })
    })

    r.add('@p2pcord/edit-message', async (edit, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      const msg = await view.get('@p2pcord/messages', { channel: edit.channel, id: edit.id })
      if (!author || !msg || !b4a.equals(author.identity, msg.author)) return
      await view.insert('@p2pcord/messages', { ...msg, text: clip(edit.text, MAX_TEXT), edited: edit.ts })
    })

    r.add('@p2pcord/remove-message', async (ref, { view, from }) => {
      const author = await view.get('@p2pcord/members', { writer: from })
      const msg = await view.get('@p2pcord/messages', ref)
      if (!author || !msg) return
      if (!b4a.equals(author.identity, msg.author) && author.role < ROLE_ADMIN) return
      await view.delete('@p2pcord/messages', ref)
    })
  }

  async _onPairRequest (request) {
    const inv = await this.view.get('@p2pcord/invites', { id: request.inviteId })
    if (!inv) return // not our invite (or revoked): another member may answer
    if (inv.expires !== 0 && inv.expires < Date.now()) return request.deny({ status: 3 })

    let data
    try {
      data = c.decode(JoinRequest, request.open(inv.publicKey))
    } catch {
      return request.deny({ status: 1 })
    }
    if (!crypto.verify(data.writer, data.signature, data.identity)) return request.deny({ status: 1 })

    const state = await this.getState()
    const identity = b4a.toString(data.identity, 'hex')
    if (state.kind === KIND_DM && state.members.length >= 2 && !state.members.some((m) => m.identity === identity)) {
      return request.deny({ status: 2 })
    }

    await this._append('@p2pcord/add-member', {
      writer: data.writer,
      identity: data.identity,
      signature: data.signature,
      name: data.name,
      role: ROLE_MEMBER,
      joined: Date.now()
    })
    await this._append('@p2pcord/use-invite', { id: inv.id })
    request.confirm({ key: this.base.key, encryptionKey: this.base.encryptionKey })
    this.emit('member-joined', data)
  }

  _append (name, value) {
    return this.base.append(Dispatch.encode(name, value))
  }

  // ---- queries ----

  async me () {
    return this.view.get('@p2pcord/members', { writer: this.base.local.key })
  }

  async getState () {
    const [info, members, channels, me] = await Promise.all([
      this.view.get('@p2pcord/info', { id: 'info' }),
      this.view.find('@p2pcord/members', {}).toArray(),
      this.view.find('@p2pcord/channels', {}).toArray(),
      this.me()
    ])

    // Collapse devices into people
    const people = new Map()
    for (const m of members) {
      const id = b4a.toString(m.identity, 'hex')
      const p = people.get(id)
      if (!p || m.role > p.role || m.joined > p.joined) {
        people.set(id, { identity: id, name: m.name, role: Math.max(m.role, p ? p.role : 0), joined: m.joined, writer: b4a.toString(m.writer, 'hex') })
      }
    }

    const latest = {}
    for (const ch of channels) {
      if (ch.kind !== CHANNEL_TEXT) continue
      const last = await this.view.findOne('@p2pcord/messages', { gte: { channel: ch.id }, lte: { channel: ch.id } }, { reverse: true, limit: 1 })
      latest[ch.id] = last ? { ts: last.ts, author: b4a.toString(last.author, 'hex') } : null
    }

    return {
      id: this.id,
      name: info ? info.name : '',
      kind: info ? info.kind : KIND_GROUP,
      created: info ? info.created : 0,
      role: me ? me.role : -1,
      members: [...people.values()],
      channels: channels
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((ch) => ({ id: ch.id, name: ch.name, kind: ch.kind, position: ch.position, latest: latest[ch.id] || null }))
    }
  }

  async listMessages (channel, { before = null, limit = 50 } = {}) {
    const range = { gte: { channel } }
    range[before ? 'lt' : 'lte'] = before ? { channel, id: before } : { channel }
    const rows = await this.view.find('@p2pcord/messages', range, { reverse: true, limit }).toArray()
    return rows.reverse().map(toMessage)
  }

  // ---- mutations ----

  async sendMessage (channel, text, { files = [], replyTo = null } = {}) {
    const ts = Date.now()
    const id = sortableId(ts)
    await this._append('@p2pcord/add-message', {
      channel,
      id,
      author: this.identity.publicKey,
      text: text || '',
      ts,
      files: files.map(fileFromJSON),
      replyTo
    })
    return id
  }

  editMessage (channel, id, text) {
    return this._append('@p2pcord/edit-message', { channel, id, text, ts: Date.now() })
  }

  deleteMessage (channel, id) {
    return this._append('@p2pcord/remove-message', { channel, id })
  }

  addChannel (name, kind) {
    return this._append('@p2pcord/add-channel', { id: randomId(), name, kind, position: Date.now() % 1e9 })
  }

  removeChannel (id) {
    return this._append('@p2pcord/remove-channel', { id })
  }

  rename (name) {
    return this._append('@p2pcord/set-info', { id: 'info', name, kind: 0, created: 0 })
  }

  setName (name) {
    return this._append('@p2pcord/set-name', { name })
  }

  async setRole (identityHex, role) {
    const members = await this.view.find('@p2pcord/members', {}).toArray()
    const m = members.find((x) => b4a.toString(x.identity, 'hex') === identityHex)
    if (m) await this._append('@p2pcord/set-role', { writer: m.writer, role })
  }

  async kick (identityHex) {
    const members = await this.view.find('@p2pcord/members', {}).toArray()
    for (const m of members) {
      if (b4a.toString(m.identity, 'hex') === identityHex) {
        await this._append('@p2pcord/remove-member', { writer: m.writer })
      }
    }
  }

  async leave () {
    const me = await this.me()
    if (me) await this._append('@p2pcord/remove-member', { writer: me.writer })
  }

  // Safe defaults: one person, valid for 24 hours
  async createInvite ({ maxUses = 1, expiresIn = 24 * 3600 * 1000 } = {}) {
    const info = await this.view.get('@p2pcord/info', { id: 'info' })
    if (info && info.kind === KIND_DM) maxUses = 1
    const expires = expiresIn ? Date.now() + expiresIn : 0
    const { id, invite, publicKey } = BlindPairing.createInvite(this.base.key, { expires })
    const code = z32.encode(invite)
    this._invites.set(code, id)
    await this._append('@p2pcord/add-invite', {
      id,
      invite,
      publicKey,
      expires,
      maxUses,
      uses: 0,
      createdBy: this.identity.publicKey
    })
    return code
  }

  // Revokes an invite created in this session (e.g. replaced in the invite dialog)
  async revokeInvite (code) {
    const id = this._invites.get(code)
    if (!id) return false
    this._invites.delete(code)
    await this._append('@p2pcord/remove-invite', { id })
    return true
  }

  // ---- files ----

  async putFile (source, { name, mime }) {
    const id = b4a.isBuffer(source) ? await this.blobs.put(source) : await source(this.blobs)
    return {
      core: b4a.toString(this.blobs.core.key, 'hex'),
      ...id,
      name: clip(name, 200),
      mime: clip(mime || 'application/octet-stream', 100)
    }
  }

  async _blobsFor (coreHex) {
    if (coreHex === b4a.toString(this.blobs.core.key, 'hex')) return this.blobs
    let blobs = this._remoteBlobs.get(coreHex)
    if (!blobs) {
      const core = this.store.get({ key: b4a.from(coreHex, 'hex'), encryption: this._blobEncryption })
      blobs = new Hyperblobs(core)
      this._remoteBlobs.set(coreHex, blobs)
    }
    await blobs.ready()
    return blobs
  }

  async readFile (file, opts) {
    const blobs = await this._blobsFor(file.core)
    return blobs.get(blobId(file), { timeout: 30000, ...opts })
  }

  async createFileReadStream (file) {
    const blobs = await this._blobsFor(file.core)
    return blobs.createReadStream(blobId(file), { timeout: 60000 })
  }
}

function toMessage (m) {
  return {
    channel: m.channel,
    id: m.id,
    author: b4a.toString(m.author, 'hex'),
    text: m.text,
    ts: m.ts,
    files: (m.files || []).map(fileToJSON),
    replyTo: m.replyTo || null,
    edited: m.edited || 0
  }
}

function fileToJSON (f) {
  return {
    core: b4a.toString(f.core, 'hex'),
    blockOffset: f.blockOffset,
    blockLength: f.blockLength,
    byteOffset: f.byteOffset,
    byteLength: f.byteLength,
    name: f.name,
    mime: f.mime
  }
}

function fileFromJSON (f) {
  return {
    core: b4a.from(f.core, 'hex'),
    blockOffset: f.blockOffset,
    blockLength: f.blockLength,
    byteOffset: f.byteOffset,
    byteLength: f.byteLength,
    name: f.name,
    mime: f.mime
  }
}

function blobId (f) {
  return { blockOffset: f.blockOffset, blockLength: f.blockLength, byteOffset: f.byteOffset, byteLength: f.byteLength }
}

function clip (s, n) {
  s = String(s || '').trim()
  return s.length > n ? s.slice(0, n) : s
}

function randomId () {
  return b4a.toString(crypto.randomBytes(8), 'hex')
}

function sortableId (ts) {
  return ts.toString(16).padStart(12, '0') + b4a.toString(crypto.randomBytes(4), 'hex')
}

Space.KIND_GROUP = KIND_GROUP
Space.KIND_DM = KIND_DM
Space.ROLE_MEMBER = ROLE_MEMBER
Space.ROLE_ADMIN = ROLE_ADMIN
Space.ROLE_OWNER = ROLE_OWNER
Space.CHANNEL_TEXT = CHANNEL_TEXT
Space.CHANNEL_VOICE = CHANNEL_VOICE

module.exports = Space
