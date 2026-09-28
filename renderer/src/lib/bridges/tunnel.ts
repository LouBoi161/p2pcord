// The link between the iPhone web app and a bridge (a friend's desktop app):
// a WebRTC data channel, set up through Nostr relays. Both sides know the
// bridge code; it derives the relay topic and the AES-GCM key that seals the
// offer and answer. Only someone with the code can read or forge them, and
// because the sealed SDP carries the DTLS fingerprints, the data channel
// itself is end-to-end encrypted between exactly these two devices.
import { Relays, newSecret, signEvent } from './nostr'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const CODE_PREFIX = 'pb1-'
const CODE = /pb1-[A-Za-z0-9_-]{22}/

export function newCode () {
  return CODE_PREFIX + b64url(crypto.getRandomValues(new Uint8Array(16)))
}

// Accepts the bare code or a link that contains it
export function parseCode (text: string): string | null {
  const m = CODE.exec(String(text || ''))
  return m ? m[0] : null
}

export function b64url (bytes: Uint8Array) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function toBase64 (bytes: Uint8Array) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function fromBase64 (text: string) {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function hex (bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha (label: string, code: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('p2pcord-bridge/' + label + '/' + code)))
}

export interface TunnelKeys {
  topic: string
  key: CryptoKey
}

export async function tunnelKeys (code: string): Promise<TunnelKeys> {
  const topic = hex(await sha('topic', code))
  const key = await crypto.subtle.importKey('raw', await sha('key', code), 'AES-GCM', false, ['encrypt', 'decrypt'])
  return { topic, key }
}

export async function seal (keys: TunnelKeys, obj: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(keys.topic) }, keys.key, encoder.encode(JSON.stringify(obj))))
  const out = new Uint8Array(12 + data.length)
  out.set(iv)
  out.set(data, 12)
  return toBase64(out)
}

export async function unseal (keys: TunnelKeys, text: string): Promise<any | null> {
  try {
    const buf = fromBase64(text)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12), additionalData: encoder.encode(keys.topic) }, keys.key, buf.subarray(12))
    return JSON.parse(decoder.decode(plain))
  } catch {
    return null
  }
}

// Signaling messages older than this are ignored (replays)
export const MAX_AGE = 120 * 1000

export async function sendSignal (relays: Relays, keys: TunnelKeys, msg: Record<string, unknown>) {
  const content = await seal(keys, { ...msg, ts: Date.now() })
  return relays.publish(signEvent(newSecret(), keys.topic, content))
}

// Candidates go inside the one offer/answer: nobody has to trickle over the relays
export function gathered (pc: RTCPeerConnection, timeout = 4000) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const t = setTimeout(done, timeout)
    function done () {
      clearTimeout(t)
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    function check () {
      if (pc.iceGatheringState === 'complete') done()
    }
    pc.addEventListener('icegatheringstatechange', check)
  })
}

// Calls onLost when the connection fails, or stays interrupted for a while
// (a phone switching networks can recover within seconds)
export function watchConnection (pc: RTCPeerConnection, onLost: () => void, grace = 8000) {
  let timer: ReturnType<typeof setTimeout> | null = null
  pc.addEventListener('connectionstatechange', () => {
    const state = pc.connectionState
    if (timer && state !== 'disconnected') {
      clearTimeout(timer)
      timer = null
    }
    if (state === 'failed' || state === 'closed') onLost()
    else if (state === 'disconnected' && !timer) timer = setTimeout(onLost, grace)
  })
}

// JSON messages over a data channel. Anything larger than one SCTP message
// Safari accepts is split into parts; sending waits when the buffer fills up.
const PART = 16 * 1024
const HIGH_WATER = 4 * 1024 * 1024

export class Pipe {
  onmessage: (msg: any) => void = () => {}
  onclose: () => void = () => {}
  private parts = new Map<string, string[]>()
  private queue: string[] = []
  private nextId = 1
  closed = false
  private dc: RTCDataChannel

  constructor (dc: RTCDataChannel) {
    this.dc = dc
    dc.bufferedAmountLowThreshold = HIGH_WATER / 4
    dc.onbufferedamountlow = () => this.flush()
    dc.onmessage = (e) => this.receive(typeof e.data === 'string' ? e.data : '')
    dc.onclose = () => this.close()
    dc.onerror = () => this.close()
  }

  send (msg: unknown) {
    if (this.closed) return false
    const text = JSON.stringify(msg)
    if (text.length <= PART) {
      this.queue.push(text)
    } else {
      const id = String(this.nextId++)
      const n = Math.ceil(text.length / PART)
      for (let i = 0; i < n; i++) this.queue.push('\u0001' + JSON.stringify([id, i, n, text.slice(i * PART, (i + 1) * PART)]))
    }
    this.flush()
    return true
  }

  private flush () {
    while (this.queue.length && this.dc.readyState === 'open' && this.dc.bufferedAmount < HIGH_WATER) {
      try {
        this.dc.send(this.queue.shift()!)
      } catch {
        this.close()
        return
      }
    }
  }

  private receive (text: string) {
    if (!text) return
    if (text.charCodeAt(0) === 1) {
      let part: [string, number, number, string]
      try {
        part = JSON.parse(text.slice(1))
      } catch {
        return
      }
      const [id, i, n, data] = part
      if (typeof id !== 'string' || !(n > 0 && n < 100000) || !(i >= 0 && i < n)) return
      let list = this.parts.get(id)
      if (!list) this.parts.set(id, (list = []))
      list[i] = data
      if (list.filter((x) => x !== undefined).length < n) return
      this.parts.delete(id)
      text = list.join('')
    }
    let msg: any
    try {
      msg = JSON.parse(text)
    } catch {
      return
    }
    this.onmessage(msg)
  }

  close () {
    if (this.closed) return
    this.closed = true
    this.queue = []
    this.parts.clear()
    try {
      this.dc.close()
    } catch {}
    this.onclose()
  }
}
