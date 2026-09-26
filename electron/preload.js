// The only bridge between the sandboxed UI and the rest of the app.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('p2p', {
  info: () => ipcRenderer.sendSync('app:info'),
  start: () => ipcRenderer.invoke('worker:start'),
  send: (bytes) => ipcRenderer.invoke('worker:send', bytes),
  onMessage: (listener) => {
    const wrap = (evt, data) => listener(new Uint8Array(data))
    ipcRenderer.on('worker:message', wrap)
    return () => ipcRenderer.removeListener('worker:message', wrap)
  },
  onExit: (listener) => {
    const wrap = (evt, code) => listener(code)
    ipcRenderer.on('worker:exit', wrap)
    return () => ipcRenderer.removeListener('worker:exit', wrap)
  },
  pathForFile: (file) => webUtils.getPathForFile(file),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  showFile: (rel) => ipcRenderer.invoke('shell:show-file', rel),
  screenSources: () => ipcRenderer.invoke('screen:sources'),
  selectScreen: (id) => ipcRenderer.invoke('screen:select', id),
  onUpdateReady: (listener) => {
    const wrap = () => listener()
    ipcRenderer.on('app:update-ready', wrap)
    return () => ipcRenderer.removeListener('app:update-ready', wrap)
  },
  applyUpdate: () => ipcRenderer.invoke('app:apply-update'),
  relaunch: () => ipcRenderer.invoke('app:relaunch')
})
