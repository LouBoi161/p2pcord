// Bare worker entry: runs the P2Pcord backend and answers JSON-RPC frames from
// the renderer (relayed byte-for-byte by the Electron main process).
const FramedStream = require('framed-stream')
const goodbye = require('graceful-goodbye')
const path = require('path')
const b4a = require('b4a')

const App = require('./app')

const METHODS = new Set([
  'init',
  'setName',
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
  'uploadFile',
  'uploadBytes',
  'fetchFile',
  'setVoice',
  'signal'
])

const storage = path.join(Bare.argv[2], 'p2pcord')
const pipe = new FramedStream(Bare.IPC)

function write (obj) {
  pipe.write(b4a.from(JSON.stringify(obj)))
}

let app = null

// The first frame from the main process carries the vault key (from the OS keychain)
function start ({ key, mode, error }) {
  app = new App(storage, {
    vaultKey: key ? b4a.from(key, 'hex') : null,
    vaultMode: mode,
    emit: (event, data) => write({ event, data })
  })
  goodbye(() => app.close())
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
  if (!msg || typeof msg.id !== 'number' || !METHODS.has(msg.method)) return
  try {
    await app.ready()
    const result = await app[msg.method](msg.params || {})
    write({ id: msg.id, result: result === undefined ? null : result })
  } catch (err) {
    write({ id: msg.id, error: (err && err.message) || String(err) })
  }
})
