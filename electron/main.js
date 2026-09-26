// Electron main: a thin, hardened shell. It spawns the Bare backend worker,
// relays its IPC frames to the renderer, serves the UI and cached files over
// private protocols and handles screen-capture selection.
const {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  protocol,
  net,
  session,
  shell,
  desktopCapturer,
  Menu,
  safeStorage,
  dialog
} = require('electron')
const fs = require('fs')
const crypto = require('crypto')
const path = require('path')
const { pathToFileURL } = require('url')
const PearRuntime = require('pear-runtime')
const FramedStream = require('framed-stream')
const { isMac, isLinux, isWindows } = require('which-runtime')

const pkg = require('../package.json')
const { productName, version, upgrade } = pkg

const APP_WORKER = '/workers/main.js'
const UPDATER_WORKER = '/workers/updater.js'
const UI_ORIGIN = 'app://p2pcord'
const UI_DIR = path.join(__dirname, '..', 'renderer', 'dist')

const rawArgs = app.isPackaged ? process.argv.slice(1) : process.argv.slice(2)
const flags = parseArgs(rawArgs)

if (flags.storage) {
  app.setPath('userData', path.resolve(flags.storage))
  if (!app.isPackaged) {
    app.setName(productName + '-' + path.basename(flags.storage))
    app.commandLine.appendSwitch('password-store', 'basic')
  }
}

// Dev only: lets automated UI checks attach over the Chrome DevTools Protocol
if (!app.isPackaged && process.env.P2PCORD_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.P2PCORD_DEBUG_PORT)
}
if (!app.isPackaged && process.env.P2PCORD_FAKE_MEDIA) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
  app.commandLine.appendSwitch('mute-audio')
}

// PipeWire screen capture on Wayland
if (isLinux) app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: 'p2pfile', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function parseArgs (argv) {
  const out = { storage: null, updates: true }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--storage') out.storage = argv[++i]
    else if (arg === '--no-updates') out.updates = false
  }
  return out
}

function getStorageDir () {
  if (flags.storage) return path.resolve(flags.storage)
  if (!app.isPackaged) return path.join(app.getPath('appData'), productName + '-dev')
  return app.getPath('userData')
}

function getAppPath () {
  if (!app.isPackaged) return null
  if (isLinux && process.env.APPIMAGE) return process.env.APPIMAGE
  if (isWindows) return process.execPath
  return path.join(process.resourcesPath, '..', '..')
}

const appStorage = () => path.join(getStorageDir(), 'app-storage')
const filesDir = () => path.join(appStorage(), 'p2pcord', 'files')

function sendToAll (channel, data) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  }
}

// ---- backend worker ----

let appPipe = null

// The vault key encrypts identity, group keys and group list at rest. It is
// protected by the OS keychain (libsecret / Keychain / DPAPI) via safeStorage.
// Without a keychain it falls back to a local file and the UI warns about it.
function loadVault () {
  const file = path.join(appStorage(), 'vault.key')
  const backend = isLinux ? safeStorage.getSelectedStorageBackend() : 'os'
  const strong = safeStorage.isEncryptionAvailable() && backend !== 'basic_text' && backend !== 'unknown'
  fs.mkdirSync(path.dirname(file), { recursive: true })

  let stored = null
  try {
    stored = fs.readFileSync(file)
  } catch {}
  const plain = stored && stored.toString('latin1').startsWith('plain:')

  let key = null
  if (stored && plain) key = stored.toString('latin1').slice(6).trim()
  else if (stored) {
    try {
      key = safeStorage.decryptString(stored)
    } catch (err) {
      console.error('[vault] keychain refused to decrypt:', err.message)
      return { error: 'VAULT_KEYRING' }
    }
  }
  if (!key) key = crypto.randomBytes(32).toString('hex')

  if (!stored || (plain && strong)) {
    const out = strong ? safeStorage.encryptString(key) : Buffer.from('plain:' + key)
    fs.writeFileSync(file + '.tmp', out, { mode: 0o600 })
    fs.renameSync(file + '.tmp', file)
  }
  return { key, mode: strong ? 'keyring' : 'weak' }
}

function getAppWorker () {
  if (appPipe) return appPipe
  const worker = PearRuntime.run(require.resolve('..' + APP_WORKER), [appStorage()])
  const pipe = new FramedStream(worker)
  appPipe = pipe
  pipe.write(Buffer.from(JSON.stringify({ type: 'vault', ...loadVault() })))
  pipe.on('data', (data) => sendToAll('worker:message', data))
  worker.stdout.on('data', (data) => process.stdout.write(data))
  worker.stderr.on('data', (data) => process.stderr.write(data))
  worker.once('exit', (code) => {
    appPipe = null
    sendToAll('worker:exit', code)
  })
  app.once('before-quit', () => pipe.destroy())
  return pipe
}

ipcMain.handle('worker:start', () => {
  getAppWorker()
  return true
})

ipcMain.handle('worker:send', (evt, data) => {
  if (!(data instanceof Uint8Array)) return false
  return getAppWorker().write(Buffer.from(data))
})

// ---- OTA updater (only with a real upgrade key) ----

function hasUpgradeKey () {
  try {
    require('pear-link').parse(upgrade)
    return true
  } catch {
    return false
  }
}

function startUpdater () {
  if (!flags.updates || !app.isPackaged || !hasUpgradeKey()) return null
  const extension = isLinux ? '.AppImage' : isMac ? '.app' : '.msix'
  const worker = PearRuntime.run(require.resolve('..' + UPDATER_WORKER), [
    flags.updates,
    version,
    upgrade,
    productName + extension,
    getStorageDir(),
    getAppPath()
  ])
  const pipe = new FramedStream(worker)
  pipe.on('data', (data) => {
    const message = data.toString()
    if (message === 'updated') sendToAll('app:update-ready', true)
  })
  worker.stderr.on('data', (data) => process.stderr.write(data))
  app.once('before-quit', () => pipe.destroy())
  ipcMain.handle('app:apply-update', () => new Promise((resolve, reject) => {
    const onData = (data) => {
      const message = data.toString()
      if (message === 'pear:updateApplied') resolve(true)
      else if (message.startsWith('pear:updateFailed')) reject(new Error(message))
      else return
      pipe.off('data', onData)
    }
    pipe.on('data', onData)
    pipe.write('pear:applyUpdate')
  }))
  return pipe
}

ipcMain.handle('app:relaunch', () => {
  if (isLinux && process.env.APPIMAGE) {
    app.relaunch({ execPath: process.env.APPIMAGE, args: ['--appimage-extract-and-run', ...process.argv.slice(1)] })
  } else if (!isWindows) {
    app.relaunch()
  }
  app.quit()
})

// ---- small helpers for the renderer ----

ipcMain.handle('clipboard:write', (evt, text) => clipboard.writeText(String(text).slice(0, 10000)))

ipcMain.handle('shell:open', (evt, url) => {
  let u
  try {
    u = new URL(String(url))
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  shell.openExternal(u.toString())
  return true
})

// Attachments live in a cache that is wiped on exit; keeping one means saving a copy
ipcMain.handle('file:save', async (evt, rel, name) => {
  const file = resolveCached(rel)
  if (!file) return false
  const win = BrowserWindow.fromWebContents(evt.sender)
  const safe = path.basename(String(name || path.basename(file))).replace(/[\\/:*?"<>|]+/g, '_')
  const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('downloads'), safe) })
  if (res.canceled || !res.filePath) return false
  await fs.promises.copyFile(file, res.filePath)
  shell.showItemInFolder(res.filePath)
  return true
})

ipcMain.on('app:info', (evt) => {
  evt.returnValue = {
    version,
    name: productName,
    storage: flags.storage ? path.basename(flags.storage) : null,
    platform: process.platform,
    debug: !app.isPackaged && !!process.env.P2PCORD_DEBUG_PORT
  }
})

// Screen share: the renderer lists sources, the user picks one, then
// getDisplayMedia() resolves to the picked source.
let pickedSource = null

ipcMain.handle('screen:sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false })
  return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() }))
})

ipcMain.handle('screen:select', (evt, id) => {
  pickedSource = typeof id === 'string' ? id : null
  return true
})

function resolveCached (rel) {
  if (typeof rel !== 'string') return null
  const root = filesDir()
  const file = path.resolve(root, rel)
  if (!file.startsWith(root + path.sep)) return null
  return file
}

// ---- window ----

async function createWindow () {
  const win = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 960,
    minHeight: 560,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    title: flags.storage ? `${productName} (${path.basename(flags.storage)})` : productName,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      spellcheck: true,
      backgroundThrottling: false // voice activity detection must keep running while gaming
    }
  })

  // No navigation away from the app, no new windows; links go to the browser
  win.webContents.on('will-navigate', (evt, url) => {
    if (!url.startsWith(UI_ORIGIN + '/')) evt.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('render-process-gone', (evt, details) => console.error('[renderer] gone:', details))

  await win.loadURL(UI_ORIGIN + '/index.html')
  if (!app.isPackaged && process.env.P2PCORD_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })
}

function setupSession () {
  const ses = session.defaultSession

  const allowed = new Set(['media', 'display-capture', 'clipboard-sanitized-write', 'notifications', 'speaker-selection', 'fullscreen'])
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(allowed.has(permission) && (details.requestingUrl || '').startsWith(UI_ORIGIN))
  })
  ses.setPermissionCheckHandler((wc, permission, origin) => allowed.has(permission) && String(origin).startsWith(UI_ORIGIN))

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const source = sources.find((s) => s.id === pickedSource) || (isLinux ? sources[0] : null)
      pickedSource = null
      if (!source) return callback({})
      callback({ video: source, audio: isWindows ? 'loopback' : undefined })
    } catch (err) {
      console.error('[screen]', err)
      callback({})
    }
  })

  // UI files
  protocol.handle('app', (req) => {
    const url = new URL(req.url)
    if (url.host !== 'p2pcord') return new Response('not found', { status: 404 })
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const file = path.resolve(UI_DIR, rel)
    if (!file.startsWith(UI_DIR + path.sep)) return new Response('forbidden', { status: 403 })
    return net.fetch(pathToFileURL(file).toString())
  })

  // Downloaded attachments: only from the cache dir, never rendered as documents
  protocol.handle('p2pfile', async (req) => {
    const url = new URL(req.url)
    const file = resolveCached(decodeURIComponent(url.pathname).replace(/^\/+/, ''))
    if (!file) return new Response('forbidden', { status: 403 })
    const res = await net.fetch(pathToFileURL(file).toString(), { headers: req.headers })
    const headers = new Headers(res.headers)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
    const type = headers.get('content-type') || ''
    if (/html|xml|svg|javascript/i.test(type)) headers.set('content-type', 'application/octet-stream')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
  })
}

// ---- lifecycle ----

const lock = app.requestSingleInstanceLock()

if (!lock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    setupSession()
    getAppWorker()
    startUpdater()
    await createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(console.error)
    })
  }).catch((err) => {
    console.error('Failed to start:', err)
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.quit())
}
