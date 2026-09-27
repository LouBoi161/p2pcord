// Desktop side of the iPhone bridge (see bridges/web.svelte.ts for the phone
// side). For every bridge code this app listens on the Nostr relays, answers
// the phone's WebRTC offer and relays its RPC frames to a guest backend in the
// worker (workers/guests.js). Nothing is stored here but the codes; the
// guest's account data stays sealed with a key only the phone holds.
import { call, on } from './rpc'
import { Relays } from './bridges/nostr'
import { Pipe, gathered, hex, newCode, sendSignal, tunnelKeys, unseal, watchConnection, MAX_AGE, type TunnelKeys } from './bridges/tunnel'
import { iceServers } from './settings.svelte'

const KEY = 'p2pcord:bridge-host'
// How long a guest stays online after the phone went away (app switch, screen lock)
const LINGER = 90 * 1000
// GitLab Pages' unique domain: an origin of its own, so no other page can read the account in localStorage
export const WEB_APP_URL = 'https://p2pcord-9e78a7.gitlab.io/'

export interface BridgeCode {
  code: string
  label: string
  created: number
  slots: string[] // guest storage the code was used for (deleted with the code)
  last: number
}

function load (): { enabled: boolean; codes: BridgeCode[] } {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { enabled: !!s.enabled, codes: Array.isArray(s.codes) ? s.codes : [] }
  } catch {
    return { enabled: false, codes: [] }
  }
}

export const host = $state({
  ...load(),
  relays: 0,
  online: {} as Record<string, boolean> // code -> a phone is connected right now
})

function save () {
  try {
    localStorage.setItem(KEY, JSON.stringify({ enabled: host.enabled, codes: $state.snapshot(host.codes) }))
  } catch {}
}

interface Session {
  code: string
  slot: string | null
  pipe: Pipe
  pc: RTCPeerConnection
}

let relays: Relays | null = null
const listening = new Map<string, () => void>() // code -> unsubscribe
const seen = new Set<string>()
const sessions = new Map<string, Session>() // code -> live session
const bySlot = new Map<string, Session>()
const lingering = new Map<string, ReturnType<typeof setTimeout>>() // slot -> close timer
let statusTimer: ReturnType<typeof setInterval> | null = null
let started = false

export function startBridgeHost () {
  if (started) return
  started = true
  on('guest', onGuest)
  sync()
}

function onGuest (data: { slot: string; msg?: unknown; account?: Record<string, string> }) {
  const s = bySlot.get(data.slot)
  if (!s) return
  if (data.msg) s.pipe.send({ t: 'msg', msg: data.msg })
  if (data.account) s.pipe.send({ t: 'account', account: data.account })
}

// Starts or stops listening so it matches the settings
function sync () {
  if (!started) return
  const want = host.enabled ? new Set(host.codes.map((c) => c.code)) : new Set<string>()
  for (const [code, unsub] of listening) {
    if (want.has(code)) continue
    unsub()
    listening.delete(code)
    sessions.get(code)?.pipe.close()
  }
  if (!want.size) {
    relays?.close()
    relays = null
    if (statusTimer) clearInterval(statusTimer)
    statusTimer = null
    host.relays = 0
    return
  }
  if (!relays) {
    relays = new Relays()
    statusTimer = setInterval(() => (host.relays = relays?.connected || 0), 2000)
  }
  for (const code of want) {
    if (listening.has(code)) continue
    tunnelKeys(code).then((keys) => {
      if (!relays || listening.has(code) || !want.has(code)) return
      listening.set(code, relays.subscribe(keys.topic, (ev) => onOffer(code, keys, ev.content)))
    })
  }
}

async function onOffer (code: string, keys: TunnelKeys, content: string) {
  const msg = await unseal(keys, content)
  if (!msg || msg.type !== 'offer' || typeof msg.sid !== 'string' || !msg.sdp) return
  if (Math.abs(Date.now() - (msg.ts || 0)) > MAX_AGE || seen.has(msg.sid)) return
  seen.add(msg.sid)
  const pc = new RTCPeerConnection({ iceServers: iceServers() })
  const giveUp = setTimeout(() => pc.close(), 40000)
  pc.ondatachannel = (e) => {
    clearTimeout(giveUp)
    accept(code, pc, e.channel)
  }
  try {
    await pc.setRemoteDescription(msg.sdp)
    await pc.setLocalDescription(await pc.createAnswer())
    await gathered(pc)
    if (relays) await sendSignal(relays, keys, { type: 'answer', sid: msg.sid, sdp: pc.localDescription!.toJSON() })
  } catch (err) {
    console.warn('[bridge-host]', err)
    clearTimeout(giveUp)
    pc.close()
  }
}

function accept (code: string, pc: RTCPeerConnection, dc: RTCDataChannel) {
  const pipe = new Pipe(dc)
  const s: Session = { code, slot: null, pipe, pc }
  watchConnection(pc, () => pipe.close())
  pipe.onclose = () => {
    try {
      pc.close()
    } catch {}
    if (sessions.get(code) === s) {
      sessions.delete(code)
      host.online[code] = false
      const entry = host.codes.find((c) => c.code === code)
      if (entry) {
        entry.last = Date.now()
        save()
      }
    }
    if (s.slot && bySlot.get(s.slot) === s) {
      bySlot.delete(s.slot)
      const slot = s.slot
      lingering.set(slot, setTimeout(() => {
        lingering.delete(slot)
        if (!bySlot.has(slot)) call('guestClose', { slot }).catch(() => {})
      }, LINGER))
    }
  }
  pipe.onmessage = (m) => onPhone(s, m)
}

async function onPhone (s: Session, m: any) {
  if (m.t === 'hello') {
    if (s.slot) return
    if (typeof m.vaultKey !== 'string' || !/^[0-9a-f]{64}$/.test(m.vaultKey)) return s.pipe.close()
    const entry = host.codes.find((c) => c.code === s.code)
    if (!entry) return s.pipe.close()
    // one phone per code at a time: a new connection replaces the old one
    const old = sessions.get(s.code)
    if (old && old !== s) old.pipe.close()
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('p2pcord-guest/' + m.vaultKey)))
    const slot = hex(digest).slice(0, 32)
    s.slot = slot
    const prev = bySlot.get(slot)
    if (prev && prev !== s) prev.pipe.close()
    const t = lingering.get(slot)
    if (t) {
      clearTimeout(t)
      lingering.delete(slot)
    }
    // registered before opening: the account files written while the guest
    // backend starts must reach the phone too
    bySlot.set(slot, s)
    try {
      await call('guestOpen', { slot, vaultKey: m.vaultKey, account: m.account || {} })
    } catch (err) {
      if (bySlot.get(slot) === s) bySlot.delete(slot)
      s.pipe.send({ t: 'error', e: err instanceof Error ? err.message : String(err) })
      s.pipe.close()
      return
    }
    if (s.pipe.closed) return
    sessions.set(s.code, s)
    host.online[s.code] = true
    if (!entry.slots.includes(slot)) entry.slots.push(slot)
    entry.last = Date.now()
    save()
    s.pipe.send({ t: 'ready' })
    return
  }
  if (!s.slot || bySlot.get(s.slot) !== s || sessions.get(s.code) !== s) return
  if (m.t === 'rpc') {
    call('guestRpc', { slot: s.slot, id: m.id, method: m.method, params: m.params }).catch((err) => {
      s.pipe.send({ t: 'msg', msg: { id: m.id, error: err instanceof Error ? err.message : String(err) } })
    })
  } else if (m.t === 'file') {
    call('guestFile', { slot: s.slot, path: m.path, offset: m.offset || 0 }).then(
      (res) => s.pipe.send({ t: 'file', q: m.q, size: res.size, data: res.data }),
      (err) => s.pipe.send({ t: 'file', q: m.q, e: err instanceof Error ? err.message : String(err) })
    )
  }
}

// ---- settings actions ----

export function setBridgeEnabled (on: boolean) {
  host.enabled = on
  save()
  sync()
}

export function createBridgeCode (label: string) {
  const entry: BridgeCode = { code: newCode(), label: label.trim().slice(0, 40) || 'iPhone', created: Date.now(), slots: [], last: 0 }
  host.codes.push(entry)
  host.enabled = true
  save()
  sync()
  return entry
}

// Revoking also deletes everything the guest had stored on this computer
export async function revokeBridgeCode (code: string) {
  const entry = host.codes.find((c) => c.code === code)
  host.codes = host.codes.filter((c) => c.code !== code)
  save()
  sync()
  for (const slot of entry?.slots || []) await call('guestDrop', { slot }).catch(() => {})
}

export function bridgeLink (code: string) {
  return WEB_APP_URL + '#bridge=' + code
}
