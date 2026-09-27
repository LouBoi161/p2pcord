// Android: the app (android/) runs the backend as a Bare Kit worklet and talks
// to this page through a WebMessageListener named P2PNative. Every message is
// a JSON string:
//   page -> app  { t: 'send', d }              one RPC frame for the backend
//                { t: 'req', id, m, a }        a call into the app itself
//   app -> page  { t: 'frame', d }             one frame from the backend
//                { t: 'res', id, r?, e? }      answer to a 'req'
//                { t: 'exit', code } | { t: 'back' } | { t: 'update', s }
import type { Bridge, BridgeInfo } from './types'
import type { UpdateState } from '../update.svelte'

export function androidBridge (native: any): Bridge {
  // the app loads the page with ?platform=android&version=…&debug=1
  const q = new URLSearchParams(location.search)
  const info: BridgeInfo = {
    version: q.get('version') || '0.0.0',
    name: 'P2Pcord',
    storage: null,
    platform: 'android',
    wayland: false,
    debug: q.get('debug') === '1',
    mobile: true,
    screenShare: false,
    bridged: false
  }
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const frames = new Set<(b: Uint8Array) => void>()
  const exits = new Set<(code: number) => void>()
  const updates = new Set<(s: UpdateState) => void>()
  const backs: (() => boolean)[] = []
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  let next = 1

  native.onmessage = (e: MessageEvent) => {
    let m: any
    try {
      m = JSON.parse(e.data)
    } catch {
      return
    }
    if (m.t === 'frame') {
      const bytes = encoder.encode(m.d)
      for (const fn of frames) fn(bytes)
    } else if (m.t === 'res') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.e) p.reject(new Error(m.e))
      else p.resolve(m.r)
    } else if (m.t === 'exit') {
      for (const fn of exits) fn(m.code)
    } else if (m.t === 'update') {
      for (const fn of updates) fn(m.s)
    } else if (m.t === 'back') {
      // newest listener first (an open dialog before the navigation below it)
      for (let i = backs.length - 1; i >= 0; i--) if (backs[i]()) return
      req('exit')
    }
  }

  function req<T = any> (m: string, ...a: any[]): Promise<T> {
    const id = next++
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      native.postMessage(JSON.stringify({ t: 'req', id, m, a }))
    })
  }

  const listen = <T>(set: Set<T>, fn: T) => {
    set.add(fn)
    return () => set.delete(fn)
  }

  return {
    info: () => info,
    start: () => req('start'),
    send: async (bytes) => {
      native.postMessage(JSON.stringify({ t: 'send', d: decoder.decode(bytes) }))
      return true
    },
    onMessage: (fn) => listen(frames, fn),
    onExit: (fn) => listen(exits, fn),
    pathForFile: () => '',
    fileUrl: async (rel) => location.origin + '/p2pfile/' + rel.split('/').map(encodeURIComponent).join('/'),
    writeClipboard: (text) => req('clipboard', String(text).slice(0, 10000)),
    openExternal: (url) => req('open', String(url)),
    saveFile: (rel, name) => req('save', rel, name),
    screenSources: async () => [],
    selectScreen: async () => false,
    streamAudio: {
      available: async () => false,
      apps: async () => [],
      start: async () => false,
      unmute: async () => false,
      stop: async () => false
    },
    onUpdateState: (fn) => listen(updates, fn),
    updateState: () => req('updateState'),
    checkUpdates: () => req('checkUpdates'),
    relaunch: async () => {},
    setZoom: (factor) => {
      ;(document.documentElement.style as any).zoom = String(Math.min(2, Math.max(0.5, Number(factor) || 1)))
    },
    notify: (title, body) => {
      req('notify', title, body).catch(() => {})
    },
    setCallActive: (active) => {
      req('call', !!active).catch(() => {})
    },
    keepAwake: (ms) => {
      req('awake', Math.max(0, Math.round(ms))).catch(() => {})
    },
    onBack: (fn) => {
      backs.push(fn)
      return () => {
        const i = backs.indexOf(fn)
        if (i !== -1) backs.splice(i, 1)
      }
    }
  }
}
