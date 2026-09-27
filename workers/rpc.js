// JSON-RPC over a byte pipe to the UI, shared by the desktop worker (pear-runtime,
// relayed by Electron main) and the Android worklet (Bare Kit, relayed by the app).
const FramedStream = require('framed-stream')
const goodbye = require('graceful-goodbye')
const b4a = require('b4a')

const App = require('./app')
const Guests = require('./guests')
const Notifier = require('./notifier')

const METHODS = new Set([
  'init',
  'setName',
  'setAvatar',
  'createSpace',
  'joinSpace',
  'cancelJoin',
  'leaveSpace',
  'getSpace',
  'renameSpace',
  'createInvite',
  'revokeInvite',
  'addChannel',
  'removeChannel',
  'setRole',
  'kick',
  'rotate',
  'listMessages',
  'sendMessage',
  'editMessage',
  'deleteMessage',
  'react',
  'uploadFile',
  'uploadBytes',
  'fetchFile',
  'setVoice',
  'signal',
  'relayInfo'
])

// Bridged guests (iPhones) never get uploadFile: it reads a path on this machine
// nor relayInfo: its TURN server listens on this machine's loopback only
const GUEST_METHODS = new Set([...METHODS].filter((m) => m !== 'uploadFile' && m !== 'relayInfo'))

const HOST_METHODS = new Set(['guestOpen', 'guestRpc', 'guestClose', 'guestDrop', 'guestFile'])

/**
 * @param {import('stream').Duplex} ipc raw byte stream to the UI side
 * @param {string} storage directory for the backend data
 * @param {object} [opts]
 * @param {boolean} [opts.guests] allow hosting bridged guests (desktop only)
 * @param {boolean} [opts.notify] decide notifications in the backend (phones), sent as 'notify' events
 */
function serve (ipc, storage, opts = {}) {
  const pipe = new FramedStream(ipc)
  const write = (obj) => pipe.write(b4a.from(JSON.stringify(obj)))

  let app = null
  let guests = null
  let notifier = null

  // The first frame carries the vault key (from the OS keychain / Android Keystore)
  function start ({ key, mode, error }) {
    if (opts.notify) {
      notifier = new Notifier({
        storage,
        me: () => (app && app.identity ? b4a.toString(app.identity.publicKey, 'hex') : null),
        myVoice: () => (app && app.presence ? app.presence.voice : null),
        emit: (data) => write({ event: 'notify', data })
      })
    }
    app = new App(storage, {
      vaultKey: key ? b4a.from(key, 'hex') : null,
      vaultMode: mode,
      emit: (event, data) => {
        write({ event, data })
        if (!notifier) return
        if (event === 'space') notifier.onSpace(data).catch(() => {})
        else if (event === 'space:removed') notifier.onRemoved(data.id)
        else if (event === 'peers') notifier.onPeers(data)
      }
    })
    if (opts.guests) {
      guests = new Guests(storage, {
        methods: GUEST_METHODS,
        emit: (data) => write({ event: 'guest', data })
      })
    }
    goodbye(async () => {
      if (notifier) notifier.close()
      if (guests) await guests.closeAll()
      await app.close()
    })
    if (error) {
      write({ event: 'fatal', data: error })
      return
    }
    app.ready().then(
      () => write({ event: 'ready', data: null }),
      (err) => {
        console.error(err)
        write({ event: 'fatal', data: (err && err.message) || String(err) })
      }
    )
  }

  pipe.on('data', async (data) => {
    let msg
    try {
      msg = JSON.parse(b4a.toString(data))
    } catch {
      return
    }
    if (!app) {
      if (msg && msg.type === 'vault') start(msg)
      return
    }
    if (!msg || typeof msg.id !== 'number') return
    if (msg.method === 'setNotify') {
      // answered even without a notifier, so the UI never waits on it
      const result = notifier ? await notifier.setPrefs(msg.params || {}) : false
      write({ id: msg.id, result })
      return
    }
    const host = guests && HOST_METHODS.has(msg.method)
    if (!host && !METHODS.has(msg.method)) return
    try {
      const params = msg.params || {}
      let result
      if (host) {
        result = await guests[msg.method](params)
      } else {
        await app.ready()
        result = await app[msg.method](params)
      }
      write({ id: msg.id, result: result === undefined ? null : result })
    } catch (err) {
      write({ id: msg.id, error: (err && err.message) || String(err) })
    }
  })

  return pipe
}

module.exports = { serve, METHODS, GUEST_METHODS }
