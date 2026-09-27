// iPhone (and any browser): the web app cannot join the P2P network, so it
// borrows a friend's desktop app as a bridge. The friend creates a bridge code
// in their settings; with it this page finds their app through Nostr relays
// and opens a WebRTC data channel to it (tunnel.ts). The backend then runs on
// the friend's computer with *this* account: identity and group list live
// here, sealed with a key that only this device keeps, and are handed to the
// bridge for as long as the connection lasts. Calls go directly from this
// device to the others (WebRTC); only their signaling passes the bridge.
import type { Bridge, BridgeInfo } from './types'
import { Relays } from './nostr'
import { Pipe, gathered, hex, parseCode, sendSignal, tunnelKeys, unseal, watchConnection, fromBase64, MAX_AGE } from './tunnel'
import { iceServers } from '../settings.svelte'

const KEY = 'p2pcord:web'
const HELLO_TIMEOUT = 90 * 1000 // opening the account on the bridge (first start downloads groups)

export interface SavedBridge {
  code: string
  label: string
  last: number // last successful connection
}

interface Stored {
  bridges: SavedBridge[]
  vaultKey: string
  account: Record<string, string>
}

function load (): Stored {
  let s: Partial<Stored> = {}
  try {
    s = JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {}
  const vaultKey = typeof s.vaultKey === 'string' && /^[0-9a-f]{64}$/.test(s.vaultKey) ? s.vaultKey : hex(crypto.getRandomValues(new Uint8Array(32)))
  return { bridges: Array.isArray(s.bridges) ? s.bridges : [], vaultKey, account: s.account || {} }
}

// Only loaded when this page really is the web app (see webBridge)
let stored: Stored = { bridges: [], vaultKey: '', account: {} }

function save () {
  try {
    localStorage.setItem(KEY, JSON.stringify(stored))
  } catch {}
}

export const web = $state({
  // unpaired: no bridge code yet; connecting; offline: no bridge answered; ready; lost: connection dropped
  status: 'connecting' as 'unpaired' | 'connecting' | 'offline' | 'ready' | 'lost',
  bridges: [] as SavedBridge[],
  error: '',
  via: '' // label of the bridge in use
})

export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches

function init () {
  stored = load()
  // A code in the address (#bridge=...) is taken over once
  const fromLink = parseCode(decodeURIComponent(location.hash))
  if (fromLink && !stored.bridges.some((b) => b.code === fromLink)) stored.bridges.push({ code: fromLink, label: 'Brücke', last: 0 })
  save()
  web.bridges = stored.bridges.slice()
}

let relays: Relays | null = null
let pipe: Pipe | null = null
let wake: (() => void) | null = null

export function addBridge (text: string, label: string) {
  const code = parseCode(text)
  if (!code) return false
  if (!stored.bridges.some((b) => b.code === code)) stored.bridges.push({ code, label: label.trim().slice(0, 40) || 'Brücke', last: 0 })
  save()
  web.bridges = stored.bridges.slice()
  retryNow()
  return true
}

export function removeBridge (code: string) {
  stored.bridges = stored.bridges.filter((b) => b.code !== code)
  save()
  web.bridges = stored.bridges.slice()
}

export function retryNow () {
  const w = wake
  wake = null
  w?.()
}

// Everything this device knows of its account: to back it up or move it
export function exportAccount () {
  return JSON.stringify({ p2pcord: 'web-account', v: 1, vaultKey: stored.vaultKey, account: stored.account, bridges: stored.bridges })
}

export function importAccount (text: string) {
  const data = JSON.parse(text)
  if (data?.p2pcord !== 'web-account' || !/^[0-9a-f]{64}$/.test(data.vaultKey)) throw new Error('Das ist keine P2Pcord-Kontosicherung.')
  stored.vaultKey = data.vaultKey
  stored.account = data.account || {}
  for (const b of data.bridges || []) if (parseCode(b.code) && !stored.bridges.some((x) => x.code === b.code)) stored.bridges.push(b)
  save()
}

const hasAccount = () => !!stored.account['identity.json']

// ---- connecting ----

interface Attempt {
  bridge: SavedBridge
  pc: RTCPeerConnection
  dc: RTCDataChannel
  close: () => void
}

// Offers a connection to one bridge; resolves with the open data channel
async function attempt (bridge: SavedBridge, signal: { cancelled: boolean }): Promise<Attempt | null> {
  const keys = await tunnelKeys(bridge.code)
  const pc = new RTCPeerConnection({ iceServers: iceServers() })
  const dc = pc.createDataChannel('p2pcord', { ordered: true })
  const sid = hex(crypto.getRandomValues(new Uint8Array(8)))
  let unsub = () => {}
  const close = () => {
    unsub()
    try {
      pc.close()
    } catch {}
  }
  try {
    await pc.setLocalDescription(await pc.createOffer())
    await gathered(pc)
    let answered = false
    unsub = relays!.subscribe(keys.topic, async (ev) => {
      const msg = await unseal(keys, ev.content)
      if (!msg || msg.type !== 'answer' || msg.sid !== sid || answered) return
      if (Math.abs(Date.now() - (msg.ts || 0)) > MAX_AGE) return
      answered = true
      try {
        await pc.setRemoteDescription(msg.sdp)
      } catch {
        close()
      }
    })
    const open = new Promise<boolean>((resolve) => {
      dc.onopen = () => resolve(true)
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') resolve(false)
      }
    })
    const offer = { type: 'offer', sid, sdp: pc.localDescription!.toJSON() }
    // the bridge may still be connecting to the relays: offer a few times
    for (let i = 0; i < 5 && !answered && !signal.cancelled; i++) {
      await sendSignal(relays!, keys, offer)
      const ok = await Promise.race([open, new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))])
      if (ok !== null) break
    }
    if (!answered || signal.cancelled) {
      close()
      return null
    }
    const ok = await Promise.race([open, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 25000))])
    if (!ok || signal.cancelled) {
      close()
      return null
    }
    unsub()
    return { bridge, pc, dc, close }
  } catch (err) {
    console.warn('[bridge]', err)
    close()
    return null
  }
}

// Asks every saved bridge at once; the first open channel wins
async function connectAny (): Promise<Attempt | null> {
  const signal = { cancelled: false }
  const list = stored.bridges.slice().sort((a, b) => b.last - a.last)
  return new Promise((resolve) => {
    let left = list.length
    let won: Attempt | null = null
    if (!left) resolve(null)
    for (const b of list) {
      attempt(b, signal).then((a) => {
        left--
        if (a && !won) {
          won = a
          signal.cancelled = true
          resolve(a)
        } else if (a) {
          a.close()
        }
        if (!left && !won) resolve(null)
      })
    }
  })
}

function sleep (ms: number) {
  return new Promise<void>((resolve) => {
    const t = setTimeout(done, ms)
    function done () {
      clearTimeout(t)
      if (wake === done) wake = null
      resolve()
    }
    wake = done
  })
}

// ---- the bridge ----

export function webBridge (): Bridge {
  init()
  const mobile = isIOS || matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700
  const info: BridgeInfo = {
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0',
    name: 'P2Pcord',
    storage: null,
    platform: 'web',
    wayland: false,
    debug: false,
    mobile,
    screenShare: !isIOS && !mobile && !!navigator.mediaDevices?.getDisplayMedia,
    bridged: true
  }
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const frames = new Set<(b: Uint8Array) => void>()
  const exits = new Set<(code: number) => void>()
  const files = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  const urls = new Map<string, Promise<string>>()
  let nextFile = 1
  let started: Promise<boolean> | null = null

  function deliver (msg: unknown) {
    const bytes = encoder.encode(JSON.stringify(msg))
    for (const fn of frames) fn(bytes)
  }

  async function run (): Promise<boolean> {
    relays = new Relays()
    for (;;) {
      if (!stored.bridges.length) {
        web.status = 'unpaired'
        await sleep(3600 * 1000)
        continue
      }
      web.status = 'connecting'
      web.error = ''
      await relays.ready()
      const a = await connectAny()
      if (!a) {
        web.status = 'offline'
        await sleep(15000)
        continue
      }
      const ok = await hello(a)
      if (ok) {
        a.bridge.last = Date.now()
        save()
        web.bridges = stored.bridges.slice()
        web.via = a.bridge.label
        web.status = 'ready'
        return true
      }
      a.close()
      web.status = 'offline'
      await sleep(15000)
    }
  }

  function hello (a: Attempt): Promise<boolean> {
    const p = new Pipe(a.dc)
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        web.error = 'Die Brücke hat nicht geantwortet.'
        resolve(false)
      }, HELLO_TIMEOUT)
      p.onmessage = (m) => {
        if (m.t === 'ready') {
          clearTimeout(t)
          pipe = p
          p.onmessage = onPipe
          resolve(true)
        } else if (m.t === 'error') {
          clearTimeout(t)
          web.error = m.e === 'BRIDGE_FULL' ? 'Die Brücke ist gerade voll (zu viele iPhones).' : String(m.e || 'Fehler')
          resolve(false)
        } else if (m.t === 'account') {
          onPipe(m)
        }
      }
      p.onclose = () => {
        clearTimeout(t)
        if (pipe === p) lost()
        else resolve(false)
      }
      watchConnection(a.pc, () => p.close())
      p.send({ t: 'hello', v: 1, vaultKey: stored.vaultKey, account: stored.account, fresh: !hasAccount() })
    })
  }

  function onPipe (m: any) {
    if (m.t === 'msg') deliver(m.msg)
    else if (m.t === 'account' && m.account && typeof m.account === 'object') {
      for (const [name, data] of Object.entries(m.account)) if (typeof data === 'string') stored.account[name] = data
      save()
    } else if (m.t === 'file') {
      const p = files.get(m.q)
      if (!p) return
      files.delete(m.q)
      if (m.e) p.reject(new Error(m.e))
      else p.resolve(m)
    }
  }

  // The page restarts from scratch once a bridge is back: simpler and safer
  // than patching up calls and state that ran through the old one
  function lost () {
    pipe = null
    web.status = 'lost'
    for (const p of files.values()) p.reject(new Error('BRIDGE_LOST'))
    files.clear()
    for (const fn of exits) fn(0)
    const again = async () => {
      await relays!.ready()
      const a = await connectAny()
      if (a) {
        a.close()
        location.reload()
      } else {
        setTimeout(again, 10000)
      }
    }
    setTimeout(again, 1500)
  }

  function fileChunk (path: string, offset: number): Promise<{ size: number; data: string }> {
    if (!pipe) return Promise.reject(new Error('BRIDGE_LOST'))
    const q = nextFile++
    return new Promise((resolve, reject) => {
      files.set(q, { resolve, reject })
      pipe!.send({ t: 'file', q, path, offset })
    })
  }

  async function download (rel: string, mime?: string) {
    const parts: Uint8Array[] = []
    let offset = 0
    for (;;) {
      const { size, data } = await fileChunk(rel, offset)
      const bytes = fromBase64(data)
      parts.push(bytes)
      offset += bytes.length
      if (offset >= size || !bytes.length) break
    }
    return URL.createObjectURL(new Blob(parts as BlobPart[], mime ? { type: mime } : undefined))
  }

  const listen = <T>(set: Set<T>, fn: T) => {
    set.add(fn)
    return () => set.delete(fn)
  }

  return {
    info: () => info,
    start: () => (started ||= run()),
    send: async (bytes) => {
      if (!pipe) throw new Error('BRIDGE_LOST')
      let msg: any
      try {
        msg = JSON.parse(decoder.decode(bytes))
      } catch {
        return false
      }
      return pipe.send({ t: 'rpc', id: msg.id, method: msg.method, params: msg.params })
    },
    onMessage: (fn) => listen(frames, fn),
    onExit: (fn) => listen(exits, fn),
    pathForFile: () => '',
    fileUrl: (rel, mime) => {
      let p = urls.get(rel)
      if (!p) {
        p = download(rel, mime)
        urls.set(rel, p)
        p.catch(() => urls.delete(rel))
      }
      return p
    },
    writeClipboard: async (text) => {
      try {
        await navigator.clipboard.writeText(String(text).slice(0, 10000))
      } catch {}
    },
    openExternal: async (url) => {
      let u: URL
      try {
        u = new URL(String(url))
      } catch {
        return false
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
      window.open(u.toString(), '_blank', 'noopener,noreferrer')
      return true
    },
    saveFile: async (rel, name) => {
      const url = await (urls.get(rel) || download(rel))
      const a = document.createElement('a')
      a.href = url
      a.download = name || 'datei'
      document.body.appendChild(a)
      a.click()
      a.remove()
      return true
    },
    screenSources: async () => [],
    selectScreen: async () => true,
    streamAudio: {
      available: async () => false,
      apps: async () => [],
      start: async () => false,
      unmute: async () => false,
      stop: async () => false
    },
    onUpdateState: () => () => {},
    updateState: async () => ({ status: 'disabled' }),
    checkUpdates: async () => ({ status: 'disabled' }),
    relaunch: async () => location.reload(),
    setZoom: (factor) => {
      ;(document.documentElement.style as any).zoom = String(Math.min(2, Math.max(0.5, Number(factor) || 1)))
    },
    notify: null,
    setCallActive: () => {},
    onBack: () => () => {}
  }
}
