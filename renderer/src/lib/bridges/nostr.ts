// A minimal Nostr client, used only to find a bridge: the iPhone web app and a
// friend's desktop app exchange one WebRTC offer and answer through public
// relays. Events are ephemeral (kind 2xxxx, relays forward but do not store
// them), signed with a throwaway key per session and carry only ciphertext
// (see tunnel.ts); the relays learn nothing but a random topic and timing.
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

export const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
  'wss://offchain.pub'
]

export const KIND = 25050

export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

const encoder = new TextEncoder()

export function signEvent (secret: Uint8Array, topic: string, content: string): NostrEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(secret))
  const created_at = Math.floor(Date.now() / 1000)
  const tags = [['t', topic]]
  const id = bytesToHex(sha256(encoder.encode(JSON.stringify([0, pubkey, created_at, KIND, tags, content]))))
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secret))
  return { id, pubkey, created_at, kind: KIND, tags, content, sig }
}

export function newSecret () {
  return schnorr.utils.randomSecretKey()
}

// One connection per relay, reconnecting with backoff; subscriptions are
// replayed after a reconnect.
export class Relays {
  private sockets = new Map<string, WebSocket>()
  private subs = new Map<string, { topic: string; fn: (e: NostrEvent) => void }>()
  private seen = new Set<string>()
  private closed = false
  private retry = new Map<string, number>()
  private timers = new Set<ReturnType<typeof setTimeout>>()

  constructor (private urls: string[] = RELAYS) {
    for (const url of urls) this.connect(url)
  }

  get connected () {
    let n = 0
    for (const ws of this.sockets.values()) if (ws.readyState === WebSocket.OPEN) n++
    return n
  }

  private connect (url: string) {
    if (this.closed) return
    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      return this.reconnect(url)
    }
    this.sockets.set(url, ws)
    ws.onopen = () => {
      this.retry.set(url, 0)
      for (const [id, sub] of this.subs) this.req(ws, id, sub.topic)
    }
    ws.onmessage = (m) => {
      let data: any
      try {
        data = JSON.parse(m.data)
      } catch {
        return
      }
      if (!Array.isArray(data) || data[0] !== 'EVENT') return
      const sub = this.subs.get(data[1])
      const ev = data[2] as NostrEvent
      if (!sub || !ev || typeof ev.id !== 'string' || typeof ev.content !== 'string') return
      // the same event arrives from every relay; the content is authenticated
      // by the tunnel key, so the Nostr signature needs no check here
      if (this.seen.has(ev.id)) return
      this.seen.add(ev.id)
      if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-500))
      if (!ev.tags?.some((t) => t[0] === 't' && t[1] === sub.topic)) return
      sub.fn(ev)
    }
    ws.onclose = () => {
      if (this.sockets.get(url) === ws) this.sockets.delete(url)
      this.reconnect(url)
    }
    ws.onerror = () => {
      try {
        ws.close()
      } catch {}
    }
  }

  private reconnect (url: string) {
    if (this.closed) return
    const n = (this.retry.get(url) || 0) + 1
    this.retry.set(url, n)
    const t = setTimeout(() => {
      this.timers.delete(t)
      this.connect(url)
    }, Math.min(60000, 1000 * 2 ** Math.min(n, 6)))
    this.timers.add(t)
  }

  private req (ws: WebSocket, id: string, topic: string) {
    try {
      ws.send(JSON.stringify(['REQ', id, { kinds: [KIND], '#t': [topic], since: Math.floor(Date.now() / 1000) - 30 }]))
    } catch {}
  }

  subscribe (topic: string, fn: (e: NostrEvent) => void) {
    const id = 'p2p' + Math.random().toString(36).slice(2, 10)
    this.subs.set(id, { topic, fn })
    for (const ws of this.sockets.values()) if (ws.readyState === WebSocket.OPEN) this.req(ws, id, topic)
    return () => {
      this.subs.delete(id)
      for (const ws of this.sockets.values()) {
        if (ws.readyState !== WebSocket.OPEN) continue
        try {
          ws.send(JSON.stringify(['CLOSE', id]))
        } catch {}
      }
    }
  }

  publish (ev: NostrEvent) {
    const msg = JSON.stringify(['EVENT', ev])
    let sent = 0
    for (const ws of this.sockets.values()) {
      if (ws.readyState !== WebSocket.OPEN) continue
      try {
        ws.send(msg)
        sent++
      } catch {}
    }
    return sent
  }

  // resolves once at least one relay is connected (or after the timeout)
  async ready (timeout = 8000) {
    const start = Date.now()
    while (!this.connected && Date.now() - start < timeout && !this.closed) await new Promise((resolve) => setTimeout(resolve, 100))
    return this.connected > 0
  }

  close () {
    this.closed = true
    for (const t of this.timers) clearTimeout(t)
    for (const ws of this.sockets.values()) {
      try {
        ws.close()
      } catch {}
    }
    this.sockets.clear()
    this.subs.clear()
  }
}
