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
const { spawn } = require('child_process')
const path = require('path')
const { pathToFileURL } = require('url')
const PearRuntime = require('pear-runtime')
const { createUpdater, installMode } = require('./updater')
const FramedStream = require('framed-stream')
const { isMac, isLinux, isWindows } = require('which-runtime')

const pkg = require('../package.json')
const { productName, version } = pkg

const APP_WORKER = '/workers/main.js'
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

// ---- updates (see updater.js) ----

let updater = null

function startUpdater () {
  if (!flags.updates || !app.isPackaged) return
  updater = createUpdater({
    fetch: net.fetch,
    version,
    mode: installMode({ platform: process.platform, appImage: process.env.APPIMAGE, execPath: process.execPath }),
    appImage: process.env.APPIMAGE,
    onState: (state) => sendToAll('app:update-state', state)
  })
  updater.start()
  app.once('before-quit', () => updater.stop())
}

ipcMain.handle('app:update-state', () => updater ? updater.state : { status: 'disabled' })
ipcMain.handle('app:check-updates', () => updater ? updater.check({ manual: true }) : { status: 'disabled' })

// app.relaunch() does not survive an AppImage: its helper runs from the
// mount, which disappears when we quit. A shell outside the mount waits for
// this process to exit (it holds the single-instance lock) and then starts
// the AppImage file, which may just have been replaced by an update.
function relaunchAppImage (file) {
  const env = { ...process.env }
  const mount = env.APPDIR
  const cwd = env.OWD || app.getPath('home')
  for (const key of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete env[key]
  if (mount) {
    for (const key of ['PATH', 'LD_LIBRARY_PATH', 'XDG_DATA_DIRS', 'GSETTINGS_SCHEMA_DIR']) {
      if (env[key] == null) continue
      env[key] = env[key].split(':').filter((p) => p && !p.startsWith(mount)).join(':')
      if (!env[key]) delete env[key]
    }
  }
  // Electron leaves many descriptors inheritable, among them the old mount;
  // they are closed first, or that mount would stay busy forever. dash can
  // only close fds 0-9, so this needs bash (present on practically every distro).
  const script = [
    'for fd in /proc/$$/fd/*; do n=${fd##*/}; [ "$n" -gt 2 ] && eval "exec $n>&-"; done 2>/dev/null',
    'i=0; while kill -0 "$1" 2>/dev/null && [ $i -lt 300 ]; do sleep 0.2; i=$((i+1)); done',
    'shift; exec "$@"'
  ].join('\n')
  const shell = ['/bin/bash', '/usr/bin/bash'].find((f) => fs.existsSync(f))
  if (!shell) return false
  spawn(shell, ['-c', script, 'p2pcord-relaunch', String(process.pid), file, ...process.argv.slice(1)], {
    detached: true,
    stdio: 'ignore',
    cwd,
    env
  }).unref()
  return true
}

ipcMain.handle('app:relaunch', () => {
  if (isLinux && process.env.APPIMAGE) {
    // without bash the user starts the app again by hand
    relaunchAppImage(process.env.APPIMAGE)
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
    wayland: isWayland,
    debug: !app.isPackaged && !!process.env.P2PCORD_DEBUG_PORT
  }
})

// Screen share: the renderer lists sources, the user picks one, then
// getDisplayMedia() resolves to the picked source.
// On Wayland every source enumeration opens the system (portal) picker and a
// picked source can only be used once, so there the portal is the only picker
// and it is asked exactly once, inside the display-media handler.
const isWayland = isLinux && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)

let pickedSource = null
let listedSources = new Map() // id -> source from the last in-app picker listing

ipcMain.handle('screen:sources', async () => {
  if (isWayland) return []
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false })
  listedSources = new Map(sources.map((s) => [s.id, s]))
  return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL() }))
})

ipcMain.handle('screen:select', (evt, id) => {
  pickedSource = typeof id === 'string' ? id : null
  return true
})

// ---- stream audio on Linux ----
// Chromium cannot capture system audio on Linux. venmic (also used by Vesktop)
// creates a virtual PipeWire microphone and links other applications' output
// into it - never our own audio process, so friends do not hear themselves.

let venmic = null
function patchBay () {
  if (!isLinux) return null
  if (venmic !== null) return venmic || null
  venmic = false
  try {
    const dir = path.dirname(require.resolve('@vencord/venmic/package.json'))
    const { PatchBay } = require(path.join(dir, 'prebuilds', `venmic-addon-linux-${process.arch}`, 'node-napi-v7.node'))
    if (PatchBay.hasPipeWire()) venmic = new PatchBay()
  } catch (err) {
    console.warn('[venmic] not available:', err.message)
  }
  return venmic || null
}

function audioServicePid () {
  const m = app.getAppMetrics().find((p) => p.type === 'Utility' && p.name === 'Audio Service')
  return m ? String(m.pid) : null
}

ipcMain.handle('stream-audio:available', () => !!patchBay())

ipcMain.handle('stream-audio:apps', () => {
  const bay = patchBay()
  if (!bay) return []
  const own = audioServicePid()
  const seen = new Set()
  const out = []
  for (const node of bay.list(['application.name', 'application.process.binary', 'application.process.id'])) {
    const name = node['application.name'] || node['application.process.binary']
    if (!name || node['application.process.id'] === own || seen.has(name)) continue
    seen.add(name)
    out.push({ name, binary: node['application.process.binary'] || '' })
  }
  return out
})

// app: null = everything except P2Pcord itself
ipcMain.handle('stream-audio:start', (evt, appName) => {
  const bay = patchBay()
  if (!bay) return false
  const own = audioServicePid()
  const exclude = own ? [{ 'application.process.id': own }] : []
  const data = {
    exclude,
    ignore_devices: true,
    only_speakers: true,
    only_default_speakers: true,
    // Chromium's own record stream is redirected to the virtual mic
    workaround: own ? [{ 'application.process.id': own, 'media.name': 'RecordStream' }] : []
  }
  if (typeof appName === 'string' && appName) data.include = [{ 'application.name': appName }]
  return bay.link(data)
})

ipcMain.handle('stream-audio:unmute', () => {
  patchBay()?.unmute()
  return true
})

ipcMain.handle('stream-audio:stop', () => {
  patchBay()?.unlink()
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

let mainWindow = null

async function createWindow () {
  const win = new BrowserWindow({
    width: 1360,
    height: 840,
    minWidth: 640,
    minHeight: 480,
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

  mainWindow = win

  // No navigation away from the app, no new windows; links go to the browser
  win.webContents.on('will-navigate', (evt, url) => {
    if (!url.startsWith(UI_ORIGIN + '/')) evt.preventDefault()
  })
  // Only stream pop-outs: blank same-origin windows the UI fills itself
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url !== 'about:blank' || !/^p2pcord-stream-[0-9a-f]{1,16}$/.test(frameName)) return { action: 'deny' }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1280,
        height: 720,
        minWidth: 320,
        minHeight: 180,
        backgroundColor: '#000000',
        autoHideMenuBar: true,
        icon: path.join(__dirname, '..', 'build', 'icon.png'),
        webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false }
      }
    }
  })
  win.webContents.on('did-create-window', (child) => {
    child.setMenu(null)
    child.webContents.on('will-navigate', (evt) => evt.preventDefault())
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
  // pop-outs belong to the main window
  win.on('closed', () => {
    for (const other of BrowserWindow.getAllWindows()) if (!other.isDestroyed()) other.destroy()
  })
  win.webContents.on('render-process-gone', (evt, details) => console.error('[renderer] gone:', details))
  win.webContents.on('context-menu', (evt, params) => showNativeMenu(win, params))

  await win.loadURL(UI_ORIGIN + '/index.html')
  if (!app.isPackaged && process.env.P2PCORD_DEVTOOLS) win.webContents.openDevTools({ mode: 'detach' })
}

// Right-clicks the UI does not handle itself (it calls preventDefault for its
// own menus): text fields get spelling suggestions and cut/copy/paste,
// selected text gets "copy".
function showNativeMenu (win, params) {
  const items = []
  if (params.isEditable) {
    for (const word of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) })
    }
    if (params.misspelledWord) {
      items.push({
        label: 'Zum Wörterbuch hinzufügen',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      })
    }
    if (items.length) items.push({ type: 'separator' })
    const f = params.editFlags
    items.push(
      { label: 'Rückgängig', role: 'undo', enabled: f.canUndo },
      { label: 'Wiederholen', role: 'redo', enabled: f.canRedo },
      { type: 'separator' },
      { label: 'Ausschneiden', role: 'cut', enabled: f.canCut },
      { label: 'Kopieren', role: 'copy', enabled: f.canCopy },
      { label: 'Einfügen', role: 'paste', enabled: f.canPaste },
      { label: 'Alles auswählen', role: 'selectAll', enabled: f.canSelectAll }
    )
  } else if (params.selectionText && params.selectionText.trim()) {
    items.push({ label: 'Kopieren', role: 'copy' })
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
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
      let source = pickedSource ? listedSources.get(pickedSource) : null
      pickedSource = null
      listedSources = new Map()
      if (!source && isWayland) {
        // opens the GNOME/KDE portal picker; the user's choice comes back as the only source
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] })
        source = sources[0] || null
      }
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
    const win = mainWindow
    if (win && !win.isDestroyed()) {
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
