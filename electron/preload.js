// The only bridge between the sandboxed UI and the rest of the app.
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron')

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
  saveFile: (rel, name) => ipcRenderer.invoke('file:save', rel, name),
  screenSources: () => ipcRenderer.invoke('screen:sources'),
  selectScreen: (id) => ipcRenderer.invoke('screen:select', id),
  streamAudio: {
    available: () => ipcRenderer.invoke('stream-audio:available'),
    apps: () => ipcRenderer.invoke('stream-audio:apps'),
    start: (app) => ipcRenderer.invoke('stream-audio:start', app),
    unmute: () => ipcRenderer.invoke('stream-audio:unmute'),
    stop: () => ipcRenderer.invoke('stream-audio:stop')
  },
  onUpdateState: (listener) => {
    const wrap = (evt, state) => listener(state)
    ipcRenderer.on('app:update-state', wrap)
    return () => ipcRenderer.removeListener('app:update-state', wrap)
  },
  updateState: () => ipcRenderer.invoke('app:update-state'),
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  setZoom: (factor) => webFrame.setZoomFactor(Math.min(2, Math.max(0.5, Number(factor) || 1)))
})
