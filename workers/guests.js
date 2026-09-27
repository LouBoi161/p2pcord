// Bridged guests: friends on an iPhone use P2Pcord as a web app that cannot
// join the P2P network itself. While one of them is connected (WebRTC data
// channel, set up by the desktop renderer), their backend runs here as a
// second App with its own identity, storage and swarm.
//
// The guest's account travels with the phone: identity, group list and
// profile pictures arrive sealed with a vault key only the phone keeps, are
// written to <storage>/guests/<slot>/ and every change is sent back. On this
// disk they stay sealed; while the guest is connected the key is in memory.
const fs = require('fs')
const path = require('path')
const b4a = require('b4a')

const App = require('./app')

const ACCOUNT_FILES = new Set(['identity.json', 'spaces.json', 'avatars.json'])
const SLOT = /^[0-9a-f]{16,64}$/
const MAX_GUESTS = 4
const MAX_CHUNK = 256 * 1024

class Guests {
  /**
   * @param {string} storage the host's backend directory
   * @param {object} opts
   * @param {Set<string>} opts.methods RPC methods a guest may call
   * @param {(data: object) => void} opts.emit sends { slot, msg } / { slot, account } to the host UI
   * @param {Array} [opts.bootstrap] DHT bootstrap (tests)
   */
  constructor (storage, { methods, emit, bootstrap }) {
    this.root = path.join(storage, 'guests')
    this.methods = methods
    this.emit = emit
    this.bootstrap = bootstrap
    this.apps = new Map() // slot -> App
  }

  _dir (slot) {
    if (typeof slot !== 'string' || !SLOT.test(slot)) throw new Error('BAD_SLOT')
    return path.join(this.root, slot)
  }

  // account: { 'identity.json': base64, ... } as the phone stored it (sealed)
  async guestOpen ({ slot, vaultKey, account }) {
    const dir = this._dir(slot)
    if (typeof vaultKey !== 'string' || !/^[0-9a-f]{64}$/.test(vaultKey)) throw new Error('BAD_VAULT_KEY')
    if (this.apps.has(slot)) await this.guestClose({ slot })
    if (this.apps.size >= MAX_GUESTS) throw new Error('BRIDGE_FULL')

    await fs.promises.mkdir(dir, { recursive: true })
    for (const [name, data] of Object.entries(account || {})) {
      if (!ACCOUNT_FILES.has(name) || typeof data !== 'string') continue
      const file = path.join(dir, name)
      await fs.promises.writeFile(file + '.tmp', b4a.from(data, 'base64'))
      await fs.promises.rename(file + '.tmp', file)
    }

    const app = new App(dir, {
      bootstrap: this.bootstrap,
      vaultKey: b4a.from(vaultKey, 'hex'),
      vaultMode: 'bridge',
      emit: (event, data) => this.emit({ slot, msg: { event, data } }),
      onPersist: (name, data) => {
        if (ACCOUNT_FILES.has(name)) this.emit({ slot, account: { [name]: b4a.toString(data, 'base64') } })
      }
    })
    this.apps.set(slot, app)
    try {
      await app.ready()
    } catch (err) {
      this.apps.delete(slot)
      await app.close().catch(noop)
      throw err
    }
    return true
  }

  // Answers arrive as { slot, msg: { id, result | error } } events, so one slow
  // call (joining a group can take minutes) never blocks the host's own RPC
  guestRpc ({ slot, id, method, params }) {
    const app = this.apps.get(slot)
    if (!app) throw new Error('GUEST_CLOSED')
    if (typeof id !== 'number' || !this.methods.has(method)) throw new Error('NOT_ALLOWED')
    Promise.resolve()
      .then(() => app[method](params || {}))
      .then(
        (result) => this.emit({ slot, msg: { id, result: result === undefined ? null : result } }),
        (err) => this.emit({ slot, msg: { id, error: (err && err.message) || String(err) } })
      )
    return true
  }

  async guestClose ({ slot }) {
    const app = this.apps.get(slot)
    if (!app) return false
    this.apps.delete(slot)
    await app.close().catch(noop)
    return true
  }

  // A revoked bridge code: everything stored for that guest goes
  async guestDrop ({ slot }) {
    const dir = this._dir(slot)
    await this.guestClose({ slot })
    await fs.promises.rm(dir, { recursive: true, force: true })
    return true
  }

  // Downloaded attachments are read in chunks and sent to the phone
  async guestFile ({ slot, path: rel, offset = 0, length = MAX_CHUNK }) {
    if (!this.apps.has(slot)) throw new Error('GUEST_CLOSED')
    const root = path.join(this._dir(slot), 'files')
    const file = path.resolve(root, String(rel || ''))
    if (!file.startsWith(root + path.sep)) throw new Error('NOT_ALLOWED')
    const fd = await fs.promises.open(file, 'r')
    try {
      const size = (await fd.stat()).size
      const len = Math.max(0, Math.min(MAX_CHUNK, length, size - offset))
      const buf = b4a.alloc(len)
      const { bytesRead } = await fd.read(buf, 0, len, offset)
      return { size, data: b4a.toString(buf.subarray(0, bytesRead), 'base64') }
    } finally {
      await fd.close()
    }
  }

  async closeAll () {
    for (const slot of [...this.apps.keys()]) await this.guestClose({ slot })
  }
}

function noop () {}

module.exports = Guests
