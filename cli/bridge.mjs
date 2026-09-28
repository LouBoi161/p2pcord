#!/usr/bin/env node
// Headless iPhone bridge: the host side of "Link to iOS" without the desktop
// app, for an always-on machine (home server, VPS, Raspberry Pi). It does what
// renderer/src/lib/bridge-host.svelte.ts does in the desktop app – listen on
// the Nostr relays for each bridge code, answer the phone's WebRTC offer and
// run the guest backends (workers/guests.js) – but has no identity of its own.
// The guests' accounts stay sealed on this disk with keys only the phones hold.
//
//   node cli/bridge.mjs add "Lenas iPhone"   new code, prints the link
//   node cli/bridge.mjs list | revoke <code|label>
//   node cli/bridge.mjs run                  keeps the bridge online
import { createRequire, registerHooks } from 'node:module'
import { webcrypto } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

// The bridge protocol is shared with the UI: tunnel.ts and nostr.ts are loaded
// as ES modules (the package is CommonJS) and './nostr' is imported without
// an extension, as vite expects
registerHooks({
  load (url, context, next) {
    return next(url, url.endsWith('.ts') ? { ...context, format: 'module-typescript' } : context)
  },
  resolve (specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (err) {
      if (!specifier.startsWith('.') || !context.parentURL?.endsWith('.ts')) throw err
      return next(specifier + '.ts', context)
    }
  }
})

const require = createRequire(import.meta.url)
const WEB_APP_URL = 'https://p2pcord-9e78a7.gitlab.io/' // as in bridge-host.svelte.ts
const STUN = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']
// How long a guest stays online after the phone went away (app switch, screen lock)
const LINGER = 90 * 1000

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    storage: { type: 'string', short: 's' },
    'max-guests': { type: 'string' },
    stun: { type: 'string', multiple: true },
    help: { type: 'boolean', short: 'h' }
  }
})

const USAGE = `P2Pcord-Brücke für iPhone/iPad (ohne Desktop-App)

  node cli/bridge.mjs [optionen] <befehl>

Befehle:
  run                    Brücke starten und online halten (Standard)
  add [name]             neuen Brücken-Code anlegen, zeigt den Link fürs iPhone
  list                   Codes anzeigen
  revoke <code|name>     Code widerrufen, löscht alles, was das iPhone hier gespeichert hat

Optionen:
  -s, --storage <ordner> Datenordner (Standard: $P2PCORD_BRIDGE_DIR oder ~/.local/share/p2pcord-bridge)
  --max-guests <n>       iPhones gleichzeitig online (Standard: 8)
  --stun <url>           eigener STUN-Server (mehrfach möglich, "none" für keinen)
`

if (opts.help) {
  process.stdout.write(USAGE)
  process.exit(0)
}

const storage = path.resolve(opts.storage || process.env.P2PCORD_BRIDGE_DIR || path.join(os.homedir(), '.local', 'share', 'p2pcord-bridge'))
const CODES = path.join(storage, 'bridge.json')
const PID = path.join(storage, 'bridge.pid')
fs.mkdirSync(storage, { recursive: true, mode: 0o700 })

function log (...args) {
  console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...args)
}

// ---- codes (bridge.json; `add`/`revoke` edit it while `run` watches it) ----

function loadCodes () {
  try {
    const s = JSON.parse(fs.readFileSync(CODES, 'utf8'))
    return Array.isArray(s.codes) ? s.codes : []
  } catch {
    return []
  }
}

function saveCodes (codes) {
  fs.writeFileSync(CODES + '.tmp', JSON.stringify({ codes }, null, 2), { mode: 0o600 })
  fs.renameSync(CODES + '.tmp', CODES)
}

// merges into what is on disk, so a code added meanwhile is never lost
function updateCode (code, fn) {
  const codes = loadCodes()
  const entry = codes.find((c) => c.code === code)
  if (!entry) return
  fn(entry)
  saveCodes(codes)
}

function runnerAlive () {
  try {
    const pid = Number(fs.readFileSync(PID, 'utf8'))
    if (!pid || pid === process.pid) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function link (code) {
  return WEB_APP_URL + '#bridge=' + code
}

function ago (t) {
  if (!t) return 'nie'
  const min = Math.round((Date.now() - t) / 60000)
  if (min < 1) return 'gerade eben'
  if (min < 120) return `vor ${min} min`
  if (min < 48 * 60) return `vor ${Math.round(min / 60)} h`
  return `vor ${Math.round(min / 1440)} Tagen`
}

const command = positionals[0] || 'run'

if (command === 'add') {
  const { newCode } = await import('../renderer/src/lib/bridges/tunnel.ts')
  const label = (positionals.slice(1).join(' ').trim() || 'iPhone').slice(0, 40)
  const codes = loadCodes()
  const entry = { code: newCode(), label, created: Date.now(), slots: [], last: 0 }
  codes.push(entry)
  saveCodes(codes)
  console.log(`Code für „${label}“ angelegt. Diesen Link auf dem iPhone/iPad in Safari öffnen:\n\n  ${link(entry.code)}\n`)
  console.log('Wer den Link hat, kann die Brücke benutzen – nur privat weitergeben.')
  if (!runnerAlive()) console.log('\nDie Brücke läuft gerade nicht: mit „node cli/bridge.mjs run“ starten.')
  process.exit(0)
}

if (command === 'list') {
  const codes = loadCodes()
  if (!codes.length) console.log('Keine Codes. Neuen anlegen mit: node cli/bridge.mjs add <name>')
  for (const c of codes) console.log(`${c.label.padEnd(24)} ${c.code}  zuletzt: ${ago(c.last)}\n${''.padEnd(24)} ${link(c.code)}`)
  process.exit(0)
}

if (command === 'revoke') {
  const what = positionals.slice(1).join(' ').trim()
  const codes = loadCodes()
  const hits = codes.filter((c) => c.code === what || c.label === what)
  if (!what || hits.length !== 1) {
    console.error(hits.length > 1 ? `„${what}“ passt auf mehrere Codes, bitte den Code angeben.` : `Kein Code „${what}“.`)
    process.exit(1)
  }
  saveCodes(codes.filter((c) => c !== hits[0]))
  // a running bridge notices the change, closes the guest and deletes its data itself
  if (!runnerAlive()) {
    for (const slot of hits[0].slots || []) fs.rmSync(path.join(storage, 'guests', slot), { recursive: true, force: true })
  }
  console.log(`„${hits[0].label}“ widerrufen.`)
  process.exit(0)
}

if (command !== 'run') {
  process.stderr.write(USAGE)
  process.exit(1)
}

// ---- run ----

if (runnerAlive()) {
  console.error(`In ${storage} läuft schon eine Brücke.`)
  process.exit(1)
}
fs.writeFileSync(PID, String(process.pid))

if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto
const { RTCPeerConnection } = await import('node-datachannel/polyfill')
const { Relays } = await import('../renderer/src/lib/bridges/nostr.ts')
const { Pipe, gathered, hex, sendSignal, tunnelKeys, unseal, watchConnection, MAX_AGE } = await import('../renderer/src/lib/bridges/tunnel.ts')
const Guests = require('../workers/guests.js')
const { GUEST_METHODS } = require('../workers/rpc.js')

const stun = (opts.stun || STUN).filter((s) => s && s !== 'none')
const iceServers = stun.length ? [{ urls: stun }] : []
const max = Math.max(1, Number(opts['max-guests']) || 8)

const guests = new Guests(storage, { methods: GUEST_METHODS, max, emit: onGuest })
const relays = new Relays()
const listening = new Map() // code -> unsubscribe
const known = new Map() // code -> label, slots (to clean up after a revoke)
const seen = new Set()
const sessions = new Map() // code -> live session
const bySlot = new Map()
const lingering = new Map() // slot -> close timer

function onGuest (data) {
  const s = bySlot.get(data.slot)
  if (!s) return
  if (data.msg) s.pipe.send({ t: 'msg', msg: data.msg })
  if (data.account) s.pipe.send({ t: 'account', account: data.account })
}

// Starts or stops listening so it matches bridge.json
async function sync () {
  const codes = loadCodes()
  const want = new Map(codes.map((c) => [c.code, c]))
  for (const [code, unsub] of listening) {
    if (want.has(code)) continue
    unsub()
    listening.delete(code)
    sessions.get(code)?.pipe.close()
    const gone = known.get(code)
    known.delete(code)
    log(`Code „${gone.label}“ widerrufen, Daten gelöscht`)
    for (const slot of gone.slots) {
      clearTimeout(lingering.get(slot))
      lingering.delete(slot)
      await guests.guestDrop({ slot }).catch((err) => log('guestDrop', err.message))
    }
  }
  for (const [code, entry] of want) {
    known.set(code, { label: entry.label, slots: [...(entry.slots || [])] })
    if (listening.has(code)) continue
    const keys = await tunnelKeys(code)
    if (listening.has(code) || !loadCodes().some((c) => c.code === code)) continue
    listening.set(code, relays.subscribe(keys.topic, (ev) => onOffer(code, keys, ev.content)))
    log(`wartet auf „${entry.label}“`)
  }
}

async function onOffer (code, keys, content) {
  const msg = await unseal(keys, content)
  if (!msg || msg.type !== 'offer' || typeof msg.sid !== 'string' || !msg.sdp) return
  if (Math.abs(Date.now() - (msg.ts || 0)) > MAX_AGE || seen.has(msg.sid)) return
  seen.add(msg.sid)
  if (seen.size > 2000) seen.clear()
  const pc = new RTCPeerConnection({ iceServers })
  const giveUp = setTimeout(() => pc.close(), 40000)
  pc.ondatachannel = (e) => {
    clearTimeout(giveUp)
    accept(code, pc, e.channel)
  }
  try {
    await pc.setRemoteDescription(msg.sdp)
    await pc.setLocalDescription(await pc.createAnswer())
    await gathered(pc)
    await sendSignal(relays, keys, { type: 'answer', sid: msg.sid, sdp: pc.localDescription.toJSON() })
  } catch (err) {
    log('Verbindungsaufbau fehlgeschlagen:', err.message || err)
    clearTimeout(giveUp)
    pc.close()
  }
}

function accept (code, pc, dc) {
  const pipe = new Pipe(dc)
  const s = { code, slot: null, pipe, pc }
  watchConnection(pc, () => pipe.close())
  pipe.onclose = () => {
    try {
      pc.close()
    } catch {}
    if (sessions.get(code) === s) {
      sessions.delete(code)
      log(`„${known.get(code)?.label}“ getrennt`)
      updateCode(code, (e) => (e.last = Date.now()))
    }
    if (s.slot && bySlot.get(s.slot) === s) {
      bySlot.delete(s.slot)
      const slot = s.slot
      lingering.set(slot, setTimeout(() => {
        lingering.delete(slot)
        if (!bySlot.has(slot)) guests.guestClose({ slot }).catch(() => {})
      }, LINGER))
    }
  }
  pipe.onmessage = (m) => onPhone(s, m)
}

async function onPhone (s, m) {
  if (m.t === 'hello') {
    if (s.slot) return
    if (typeof m.vaultKey !== 'string' || !/^[0-9a-f]{64}$/.test(m.vaultKey)) return s.pipe.close()
    if (!known.has(s.code)) return s.pipe.close()
    // one phone per code at a time: a new connection replaces the old one
    const old = sessions.get(s.code)
    if (old && old !== s) old.pipe.close()
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('p2pcord-guest/' + m.vaultKey)))
    const slot = hex(digest).slice(0, 32)
    s.slot = slot
    const prev = bySlot.get(slot)
    if (prev && prev !== s) prev.pipe.close()
    clearTimeout(lingering.get(slot))
    lingering.delete(slot)
    // registered before opening: the account files written while the guest
    // backend starts must reach the phone too
    bySlot.set(slot, s)
    try {
      await guests.guestOpen({ slot, vaultKey: m.vaultKey, account: m.account || {} })
    } catch (err) {
      if (bySlot.get(slot) === s) bySlot.delete(slot)
      log(`„${known.get(s.code)?.label}“ abgewiesen:`, err.message)
      s.pipe.send({ t: 'error', e: err.message || String(err) })
      s.pipe.close()
      return
    }
    if (s.pipe.closed) return
    sessions.set(s.code, s)
    const k = known.get(s.code)
    if (k && !k.slots.includes(slot)) k.slots.push(slot)
    updateCode(s.code, (e) => {
      e.slots = e.slots || []
      if (!e.slots.includes(slot)) e.slots.push(slot)
      e.last = Date.now()
    })
    log(`„${k?.label}“ verbunden`)
    s.pipe.send({ t: 'ready' })
    return
  }
  if (!s.slot || bySlot.get(s.slot) !== s || sessions.get(s.code) !== s) return
  if (m.t === 'rpc') {
    try {
      guests.guestRpc({ slot: s.slot, id: m.id, method: m.method, params: m.params })
    } catch (err) {
      s.pipe.send({ t: 'msg', msg: { id: m.id, error: err.message || String(err) } })
    }
  } else if (m.t === 'file') {
    guests.guestFile({ slot: s.slot, path: m.path, offset: m.offset || 0 }).then(
      (res) => s.pipe.send({ t: 'file', q: m.q, size: res.size, data: res.data }),
      (err) => s.pipe.send({ t: 'file', q: m.q, e: err.message || String(err) })
    )
  }
}

// bridge.json is replaced by rename, so watch the directory
let pending = null
fs.watch(storage, (_, name) => {
  if (name !== 'bridge.json' || pending) return
  pending = setTimeout(() => {
    pending = null
    sync().catch((err) => log('sync', err.message))
  }, 200)
})

let lastRelays = -1
setInterval(() => {
  if (relays.connected === lastRelays) return
  lastRelays = relays.connected
  log(`Nostr-Relays verbunden: ${lastRelays}`)
}, 5000)

let closing = false
async function shutdown () {
  if (closing) return
  closing = true
  log('wird beendet …')
  relays.close()
  for (const s of sessions.values()) s.pipe.close()
  await guests.closeAll().catch(() => {})
  try {
    fs.unlinkSync(PID)
  } catch {}
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

log(`P2Pcord-Brücke, Daten in ${storage}, bis zu ${max} iPhones gleichzeitig`)
await sync()
if (!listening.size) log('Noch keine Codes – anlegen mit: node cli/bridge.mjs add <name>')
