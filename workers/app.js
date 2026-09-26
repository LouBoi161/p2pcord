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
    this.spaces = new Map() // id -> Space
    this.pending = new Map() // code -> Space (joining)
    this.memberCache = new Map() // spaceId -> Set(identityHex)
    this._updateTimers = new Map()

    this.store = null
    this.swarm = null
    this.pairing = null
    this.presence = new Presence({ isMember: (identity, space) => this._isMember(identity, space) })
    this.presence.on('change', () => this.send('peers', this.presence.snapshot()))
    this.presence.on('signal', (s) => this.send('signal', s))
  }

  async _open () {
    await fs.promises.mkdir(this.storage, { recursive: true })
    await this._clearFileCache()

    const saved = await this._readJSON('identity.json')
    if (saved && saved.secretKey) {
      const secretKey = b4a.from(saved.secretKey, 'hex')
      this.identity = { publicKey: secretKey.subarray(32), secretKey }
      this.profile = { name: saved.name || '' }
    } else {
      this.identity = crypto.keyPair()
    }
    this.registry = (await this._readJSON('spaces.json')) || []
    // (Re)write both files so they are sealed with the vault from now on
    await this._saveIdentity()
    await this._saveRegistry()
    this.presence.name = this.profile.name

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
    for (const space of this.pending.values()) await space.close().catch(noop)
    for (const space of this.spaces.values()) await space.close().catch(noop)
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
      name: this.profile.name
    })
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
      encryptionKey: b4a.from(entry.encryptionKey, 'hex')
    })
    await space.ready()
    this._track(space)
  }

  _track (space) {
    this.spaces.set(space.id, space)
    space.on('update', () => this._scheduleUpdate(space))
    space.on('warning', (err) => this._warn(err))
    this._scheduleUpdate(space)
  }

  _scheduleUpdate (space) {
    if (this._updateTimers.has(space.id)) return
    this._updateTimers.set(space.id, setTimeout(async () => {
      this._updateTimers.delete(space.id)
      if (space.closing) return
      try {
        const state = await space.getState()
        this.memberCache.set(space.id, new Set(state.members.map((m) => m.identity)))
        this.send('space', state)
        if (state.role === -1 && state.members.length > 0) this.send('space:removed', { id: space.id })
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
      encryptionKey: b4a.toString(space.encryptionKey, 'hex')
    })
    await this._saveRegistry()
    this._track(space)
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
      vault: this.vaultMode
    }
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

  kick ({ id, identity }) {
    return this._space(id).kick(identity)
  }

  listMessages ({ id, channel, before, limit }) {
    return this._space(id).listMessages(channel, { before, limit: Math.min(limit || 50, 200) })
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
  async fetchFile ({ id, file }) {
    const space = this._space(id)
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
