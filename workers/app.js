// The P2Pcord backend: identity, the list of spaces, networking and the RPC
// surface the renderer talks to. Runs in the Bare worker (and in Node for tests).
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const BlindPairing = require('blind-pairing')
const ReadyResource = require('ready-resource')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const fs = require('fs')
const path = require('path')
const { pipelinePromise } = require('streamx')

const Space = require('./space')
const Presence = require('./presence')
const Vault = require('./vault')

const MAX_FILE = 2 * 1024 * 1024 * 1024 // 2 GB
const MAX_INLINE = 25 * 1024 * 1024 // pasted data sent over IPC

class App extends ReadyResource {
  /**
   * @param {string} storage directory for all app data
   * @param {object} [opts]
   * @param {Array} [opts.bootstrap] DHT bootstrap (tests)
   * @param {Buffer | null} [opts.vaultKey] key for at-rest encryption of local secrets
   * @param {'keyring' | 'weak' | 'none'} [opts.vaultMode] how the vault key itself is protected
   * @param {(event: string, data: any) => void} [opts.emit]
   */
  constructor (storage, opts = {}) {
    super()
    this.storage = storage
    this.bootstrap = opts.bootstrap
    this.vault = new Vault(opts.vaultKey || null)
    this.vaultMode = this.vault.enabled ? opts.vaultMode || 'keyring' : 'none'
    this._migrating = false
    this.send = opts.emit || (() => {})

    this.identity = null
    this.profile = { name: '' }
    this.registry = [] // [{ id, key, encryptionKey, ns }]
    this.spaces = new Map() // stable group id -> current Space
    this.archives = new Map() // stable group id -> [Space] of rotated-away bases (history)
    this.migrating = new Map() // stable group id -> Promise of a running key migration
    this.pending = new Map() // code -> Space (joining)
    this.memberCache = new Map() // spaceId -> Set(identityHex)
    this._updateTimers = new Map()

    this.store = null
    this.swarm = null
    this.pairing = null
    this.avatars = new Map() // identityHex -> { hash, mime, data } of other people, kept for when they are offline
    this._avatarTimer = null
    this.presence = new Presence({
      isMember: (identity, space) => this._isMember(identity, space),
      hasAvatar: (identity, hash) => this.avatars.get(identity)?.hash === hash
    })
    this.presence.on('change', () => this.send('peers', this.presence.snapshot()))
    this.presence.on('signal', (s) => this.send('signal', s))
    this.presence.on('avatar', (a) => this._onAvatar(a))
  }

  async _open () {
    await fs.promises.mkdir(this.storage, { recursive: true })
    await this._clearFileCache()

    const saved = await this._readJSON('identity.json')
    if (saved && saved.secretKey) {
      const secretKey = b4a.from(saved.secretKey, 'hex')
      this.identity = { publicKey: secretKey.subarray(32), secretKey }
      this.profile = { name: saved.name || '', avatar: saved.avatar || null, color: saved.color || '' }
    } else {
      this.identity = crypto.keyPair()
    }
    this.registry = (await this._readJSON('spaces.json')) || []
    // (Re)write both files so they are sealed with the vault from now on
    await this._saveIdentity()
    await this._saveRegistry()
    this.presence.name = this.profile.name
    this.presence.avatar = this.profile.avatar || null
    this.presence.color = this.profile.color || ''
    for (const [id, a] of Object.entries((await this._readJSON('avatars.json')) || {})) this.avatars.set(id, a)

    this.store = new Corestore(path.join(this.storage, 'corestore'))
    await this.store.ready()
    this.swarm = new Hyperswarm({ keyPair: this.identity, bootstrap: this.bootstrap })
    this.swarm.on('connection', (conn) => {
      conn.on('error', noop)
      this.store.replicate(conn)
      this.presence.attach(conn)
    })
    this.pairing = new BlindPairing(this.swarm)

    // Open known spaces in the background so the UI appears immediately
    const opening = this.registry.map((entry) => this._openExisting(entry).catch((err) => this._warn(err)))

    // After sealing data from an older version, compact the database so the old
    // plain-text group keys are dropped from its files
    if (this._migrating) {
      await Promise.all(opening)
      await this.store.storage.compact().catch((err) => this._warn(err))
    }
  }

  async _close () {
    for (const t of this._updateTimers.values()) clearTimeout(t)
    if (this._avatarTimer) {
      clearTimeout(this._avatarTimer)
      await this._saveAvatars().catch(noop)
    }
    for (const space of this.pending.values()) await space.close().catch(noop)
    for (const space of this.spaces.values()) await space.close().catch(noop)
    for (const list of this.archives.values()) for (const space of list) await space.close().catch(noop)
    await this.pairing.close()
    await this.swarm.destroy()
    await this.store.close()
    await this._clearFileCache().catch(noop)
  }

  // ---- persistence ----

  // Missing file -> null. A sealed file that cannot be opened is fatal: never
  // silently replace an identity we could not decrypt.
  async _readJSON (name) {
    let buf
    try {
      buf = await fs.promises.readFile(path.join(this.storage, name))
    } catch (err) {
      if (err.code === 'ENOENT') return null
      throw err
    }
    if (Vault.isSealed(buf)) {
      if (!this.vault.enabled) throw new Error('VAULT_LOCKED')
      buf = this.vault.open(buf)
    } else if (this.vault.enabled) {
      this._migrating = true // plain data from an older version, gets sealed now
    }
    return JSON.parse(b4a.toString(buf))
  }

  async _writeJSON (name, value) {
    const file = path.join(this.storage, name)
    let data = b4a.from(JSON.stringify(value))
    if (this.vault.enabled) data = this.vault.seal(data)
    await fs.promises.writeFile(file + '.tmp', data)
    await fs.promises.rename(file + '.tmp', file)
  }

  // Decrypted attachments only live here while the app runs
  async _clearFileCache () {
    const dir = path.join(this.storage, 'files')
    await fs.promises.rm(dir, { recursive: true, force: true })
    await fs.promises.mkdir(dir, { recursive: true })
  }

  _saveIdentity () {
    return this._writeJSON('identity.json', {
      secretKey: b4a.toString(this.identity.secretKey, 'hex'),
      name: this.profile.name,
      avatar: this.profile.avatar || null,
      color: this.profile.color || ''
    })
  }

  // ---- profile pictures ----

  _onAvatar ({ identity, hash, mime, data }) {
    if (hash) this.avatars.set(identity, { hash, mime, data })
    else if (this.avatars.has(identity)) this.avatars.delete(identity)
    else return
    this.send('avatar', { identity, url: hash ? `data:${mime};base64,${data}` : null })
    // writes are batched: several friends coming online at once is one write
    if (!this._avatarTimer) {
      this._avatarTimer = setTimeout(() => {
        this._avatarTimer = null
        this._saveAvatars().catch((err) => this._warn(err))
      }, 2000)
    }
  }

  _saveAvatars () {
    return this._writeJSON('avatars.json', Object.fromEntries(this.avatars))
  }

  _avatarUrls () {
    const out = {}
    for (const [id, a] of this.avatars) out[id] = `data:${a.mime};base64,${a.data}`
    const own = this.profile.avatar
    if (own) out[b4a.toString(this.identity.publicKey, 'hex')] = `data:${own.mime};base64,${own.data}`
    return out
  }

  _saveRegistry () {
    return this._writeJSON('spaces.json', this.registry)
  }

  // ---- spaces ----

  _newSpace (ns, opts) {
    return new Space({
      store: this.store.namespace(ns),
      swarm: this.swarm,
      pairing: this.pairing,
      identity: this.identity,
      profileName: this.profile.name || 'Unbekannt',
      blindEncryption: this.vault.blindEncryption,
      ...opts
    })
  }

  async _openExisting (entry) {
    const space = this._newSpace(entry.ns, {
      key: b4a.from(entry.key, 'hex'),
      encryptionKey: b4a.from(entry.encryptionKey, 'hex'),
      root: entry.id
    })
    await space.ready()
    this._track(space)
    for (const old of entry.history || []) this._openArchive(entry.id, old).catch((err) => this._warn(err))
  }

  // Rotated-away bases stay readable (history, attachments) but accept no joins
  async _openArchive (id, entry) {
    const space = this._newSpace(entry.ns, {
      key: b4a.from(entry.key, 'hex'),
      encryptionKey: b4a.from(entry.encryptionKey, 'hex'),
      root: id
    })
    await space.ready()
    await space.archive()
    this._addArchive(id, space)
  }

  _addArchive (id, space) {
    const list = this.archives.get(id) || []
    list.push(space)
    this.archives.set(id, list)
  }

  _track (space) {
    this.spaces.set(space.id, space)
    space.on('update', () => {
      this._scheduleUpdate(space)
      this._checkRekey(space)
    })
    space.on('warning', (err) => this._warn(err))
    this._scheduleUpdate(space)
    this._checkRekey(space)
  }

  // Debounced per group; always reports the group's *current* base, so an update
  // queued for a base that was just rotated away still delivers the new state
  _scheduleUpdate (space) {
    const id = space.id
    if (this._updateTimers.has(id)) return
    this._updateTimers.set(id, setTimeout(async () => {
      this._updateTimers.delete(id)
      const current = this.spaces.get(id)
      if (!current || current.closing) return
      try {
        const state = await current.getState()
        this.memberCache.set(id, new Set(state.members.map((m) => m.identity)))
        this.send('space', state)
        if (state.role === -1 && state.members.length > 0) this.send('space:removed', { id })
      } catch (err) {
        this._warn(err)
      }
    }, 80))
  }

  _isMember (identity, spaceId) {
    const set = this.memberCache.get(spaceId)
    return !!set && set.has(identity)
  }

  async _register (space, ns) {
    this.registry.push({
      id: space.id,
      ns,
      key: b4a.toString(space.key, 'hex'),
      encryptionKey: b4a.toString(space.encryptionKey, 'hex'),
      history: []
    })
    await this._saveRegistry()
    this._track(space)
  }

  // ---- key rotation ----

  // Replaces the current base of a group by its successor; the old one becomes history
  async _switchBase (id, next, ns) {
    const entry = this.registry.find((e) => e.id === id)
    const old = this.spaces.get(id)
    entry.history = [{ ns: entry.ns, key: entry.key, encryptionKey: entry.encryptionKey }, ...(entry.history || [])]
    entry.ns = ns
    entry.key = b4a.toString(next.key, 'hex')
    entry.encryptionKey = b4a.toString(next.encryptionKey, 'hex')
    await this._saveRegistry()
    old.removeAllListeners('update')
    await old.archive()
    this._addArchive(id, old)
    this._track(next)
  }

  // A member was handed a sealed invite to the successor base: move over
  _checkRekey (space) {
    const id = space.id
    if (this.migrating.has(id) || this.spaces.get(id) !== space || space.closing) return
    const run = (async () => {
      const rekey = await space.pendingRekey()
      if (!rekey) return
      const ns = b4a.toString(crypto.randomBytes(16), 'hex')
      const next = this._newSpace(ns, { invite: rekey.invite, root: id })
      this.pending.set('rekey:' + id, next)
      try {
        await next.ready()
      } catch (err) {
        await next.close().catch(noop)
        throw err
      } finally {
        this.pending.delete('rekey:' + id)
      }
      if (b4a.toString(crypto.hash(next.key), 'hex') !== rekey.ref) {
        await next.close()
        throw new Error('REKEY_MISMATCH')
      }
      await this._switchBase(id, next, ns)
    })()
    this.migrating.set(id, run)
    run.catch((err) => {
      this._warn(err)
      // nobody from the new base online yet: try again later
      setTimeout(() => this.spaces.get(id) === space && this._checkRekey(space), 30000)
    }).finally(() => this.migrating.delete(id))
  }

  // New keys for everyone still in the group; whoever is left out can no longer read along
  async rotate ({ id }) {
    const old = this._space(id)
    const state = await old.getState()
    if (state.kind !== Space.KIND_GROUP) throw new Error('NOT_A_GROUP')
    if (state.role < Space.ROLE_ADMIN) throw new Error('NOT_ALLOWED')
    if (this.migrating.has(id)) await this.migrating.get(id).catch(noop)

    const me = b4a.toString(this.identity.publicKey, 'hex')
    const others = state.members.filter((m) => m.identity !== me)
    const ns = b4a.toString(crypto.randomBytes(16), 'hex')
    const next = this._newSpace(ns, {
      create: {
        name: state.name,
        kind: state.kind,
        root: b4a.from(id, 'hex'),
        channels: state.channels.map(({ id, name, kind, position }) => ({ id, name, kind, position })),
        migrants: others.map((m) => ({ identity: b4a.from(m.identity, 'hex'), role: m.role, name: m.name }))
      }
    })
    await next.ready()

    const invite = await next.createInvite({ maxUses: Math.max(1, others.length), expiresIn: 30 * 24 * 3600 * 1000, restricted: true })
    const won = await old.announceSuccessor(next.key, invite, others.map((m) => m.identity))
    if (!won) {
      // another admin rotated at the same time: follow theirs instead
      await next.close()
      this._checkRekey(old)
      return false
    }
    await this._switchBase(id, next, ns)
    return true
  }

  _space (id) {
    const space = this.spaces.get(id)
    if (!space) throw new Error('UNKNOWN_SPACE')
    return space
  }

  _warn (err) {
    if (err && err.message === 'ABORTED') return
    console.error('[p2pcord]', err && err.stack ? err.stack : err)
  }

  // ---- RPC ----

  async init () {
    const spaces = []
    for (const space of this.spaces.values()) spaces.push(await space.getState())
    return {
      identity: b4a.toString(this.identity.publicKey, 'hex'),
      name: this.profile.name,
      spaces,
      loading: this.registry.length - this.spaces.size,
      peers: this.presence.snapshot(),
      vault: this.vaultMode,
      avatars: this._avatarUrls(),
      color: this.profile.color || ''
    }
  }

  // data: base64 image (the UI already cropped and scaled it), null removes the picture
  async setAvatar ({ data, mime, color }) {
    if (typeof color === 'string') this.profile.color = /^#[0-9a-f]{6}$/i.test(color) ? color : ''
    if (data === null) this.profile.avatar = null
    else if (data !== undefined) {
      if (!Presence.AVATAR_TYPES.has(mime) || typeof data !== 'string') throw new Error('BAD_IMAGE')
      const bytes = b4a.from(data, 'base64')
      if (bytes.byteLength > Presence.MAX_AVATAR) throw new Error('IMAGE_TOO_LARGE')
      this.profile.avatar = { hash: b4a.toString(crypto.hash(bytes), 'hex'), mime, data: b4a.toString(bytes, 'base64') }
    }
    await this._saveIdentity()
    this.presence.setAvatar(this.profile.avatar, this.profile.color)
    const a = this.profile.avatar
    return { url: a ? `data:${a.mime};base64,${a.data}` : null, color: this.profile.color }
  }

  async setName ({ name }) {
    name = String(name || '').trim().slice(0, 32)
    if (!name) throw new Error('NAME_REQUIRED')
    this.profile.name = name
    await this._saveIdentity()
    this.presence.setName(name)
    for (const space of this.spaces.values()) {
      const me = await space.me()
      if (me && me.name !== name) await space.setName(name)
    }
    return { name }
  }

  async createSpace ({ name, kind = Space.KIND_GROUP }) {
    const ns = b4a.toString(crypto.randomBytes(16), 'hex')
    const space = this._newSpace(ns, { create: { name: String(name || '').slice(0, 32), kind } })
    await space.ready()
    await this._register(space, ns)
    return space.getState()
  }

  async joinSpace ({ code }) {
    code = String(code || '').trim()
    if (this.pending.has(code)) throw new Error('ALREADY_JOINING')
    const ns = b4a.toString(crypto.randomBytes(16), 'hex')
    const space = this._newSpace(ns, { invite: code })
    this.pending.set(code, space)
    try {
      await space.ready()
    } catch (err) {
      await space.close().catch(noop)
      throw err
    } finally {
      this.pending.delete(code)
    }
    if (this.spaces.has(space.id)) {
      await space.close()
      return this.spaces.get(space.id).getState()
    }
    await this._register(space, ns)
    return space.getState()
  }

  async cancelJoin ({ code }) {
    const space = this.pending.get(String(code || '').trim())
    if (space) await space.close()
  }

  async leaveSpace ({ id }) {
    const space = this._space(id)
    await space.leave().catch(noop)
    await new Promise((resolve) => setTimeout(resolve, 300)) // let the removal replicate briefly
    await space.close()
    for (const old of this.archives.get(id) || []) await old.close().catch(noop)
    this.archives.delete(id)
    this.spaces.delete(id)
    this.memberCache.delete(id)
    this.registry = this.registry.filter((e) => e.id !== id)
    await this._saveRegistry()
    return true
  }

  getSpace ({ id }) {
    return this._space(id).getState()
  }

  renameSpace ({ id, name }) {
    return this._space(id).rename(name)
  }

  createInvite ({ id, maxUses, expiresIn }) {
    return this._space(id).createInvite({ maxUses, expiresIn })
  }

  revokeInvite ({ id, code }) {
    return this._space(id).revokeInvite(code)
  }

  addChannel ({ id, name, kind }) {
    return this._space(id).addChannel(name, kind)
  }

  removeChannel ({ id, channel }) {
    return this._space(id).removeChannel(channel)
  }

  setRole ({ id, identity, role }) {
    return this._space(id).setRole(identity, role)
  }

  // Kicking always rotates the group keys, so the removed person is really out
  async kick ({ id, identity }) {
    await this._space(id).kick(identity)
    return this.rotate({ id })
  }

  // Merges the current base with the history of rotated-away bases
  async listMessages ({ id, channel, before, limit }) {
    limit = Math.min(limit || 50, 200)
    const bases = [this._space(id), ...(this.archives.get(id) || [])]
    const all = []
    for (const space of bases) {
      const list = await space.listMessages(channel, { before, limit })
      for (const m of list) all.push({ ...m, base: space.baseId })
    }
    all.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return all.slice(-limit)
  }

  _baseFor (id, base) {
    const current = this._space(id)
    if (!base || current.baseId === base) return current
    return (this.archives.get(id) || []).find((s) => s.baseId === base) || current
  }

  sendMessage ({ id, channel, text, files, replyTo }) {
    return this._space(id).sendMessage(channel, text, { files, replyTo })
  }

  editMessage ({ id, channel, message, text }) {
    return this._space(id).editMessage(channel, message, text)
  }

  deleteMessage ({ id, channel, message }) {
    return this._space(id).deleteMessage(channel, message)
  }

  async uploadFile ({ id, path: file, name, mime }) {
    const space = this._space(id)
    const st = await fs.promises.stat(file)
    if (!st.isFile()) throw new Error('NOT_A_FILE')
    if (st.size > MAX_FILE) throw new Error('FILE_TOO_LARGE')
    return space.putFile(async (blobs) => {
      const ws = blobs.createWriteStream()
      await pipelinePromise(fs.createReadStream(file), ws)
      return ws.id
    }, { name: name || path.basename(file), mime })
  }

  async uploadBytes ({ id, data, name, mime }) {
    const buf = b4a.from(data, 'base64')
    if (buf.byteLength > MAX_INLINE) throw new Error('FILE_TOO_LARGE')
    return this._space(id).putFile(buf, { name, mime })
  }

  // Downloads a file into the local cache and returns its path relative to
  // <storage>/files, which the main process serves to the renderer.
  async fetchFile ({ id, file, base }) {
    const space = this._baseFor(id, base)
    const safe = String(file.name || 'datei').replace(/[^\w.\-() ]+/g, '_').slice(-80) || 'datei'
    const rel = path.join(id.slice(0, 16), `${file.core.slice(0, 16)}-${file.blockOffset}-${file.byteLength}-${safe}`)
    const target = path.join(this.storage, 'files', rel)
    try {
      const st = await fs.promises.stat(target)
      if (st.size === file.byteLength) return { path: rel.split(path.sep).join('/') }
    } catch {}
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    const tmp = target + '.part'
    const rs = await space.createFileReadStream(file)
    await pipelinePromise(rs, fs.createWriteStream(tmp))
    await fs.promises.rename(tmp, target)
    return { path: rel.split(path.sep).join('/') }
  }

  setVoice (voice) {
    this.presence.setVoice(voice)
    return true
  }

  signal ({ to, space, data }) {
    return this.presence.signal(to, space, data)
  }
}

function noop () {}

module.exports = App
