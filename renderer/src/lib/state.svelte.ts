// Global UI state mirrored from the backend, plus the actions that change it.
import { call, on, start, bridge } from './rpc'
import { settings } from './settings.svelte'

export const KIND_GROUP = 0
export const KIND_DM = 1
export const TEXT = 0
export const VOICE = 1
export const ROLE_ADMIN = 1
export const ROLE_OWNER = 2

export interface FileRef {
  core: string
  blockOffset: number
  blockLength: number
  byteOffset: number
  byteLength: number
  name: string
  mime: string
}

export interface Message {
  channel: string
  id: string
  author: string
  text: string
  ts: number
  files: FileRef[]
  replyTo: string | null
  edited: number
  reactions: Reaction[]
  base?: string // which (possibly rotated-away) base the message lives in
}

export interface Reaction {
  emoji: string
  who: string[] // identity keys, hex
}

export interface Channel {
  id: string
  name: string
  kind: number
  position: number
  latest: { ts: number; author: string; rev: number } | null
}

export interface Member {
  identity: string
  name: string
  role: number
  joined: number
}

export interface Space {
  id: string
  name: string
  kind: number
  created: number
  role: number
  baseId: string
  rotated: boolean
  members: Member[]
  channels: Channel[]
}

export interface Voice {
  space: string
  channel: string
  muted: boolean
  deaf: boolean
  video: boolean
  screen: boolean
}

export interface Peer {
  name: string
  voice: Voice | null
  avatar?: string | null // hash
  color?: string
}

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

export const ui = $state({
  status: 'loading' as 'loading' | 'ready' | 'fatal',
  error: '',
  me: '',
  name: '',
  loadingSpaces: 0,
  vault: 'none' as 'keyring' | 'weak' | 'none' | 'bridge',
  spaces: {} as Record<string, Space>,
  order: [] as string[],
  peers: {} as Record<string, Peer>,
  view: 'home' as string, // 'home' or a group space id
  chat: null as { space: string; channel: string } | null,
  pane: 'nav' as 'nav' | 'chat' | 'call', // phones: which screen is shown
  lastChannel: {} as Record<string, string>,
  reads: loadReads(),
  joining: [] as string[],
  toasts: [] as Toast[],
  messages: {} as Record<string, Message[]>,
  hasMore: {} as Record<string, boolean>,
  dialog: null as null | { type: string; [k: string]: any },
  avatars: {} as Record<string, string>, // identity -> image URL (data:)
  colors: loadColors() as Record<string, string>, // identity -> chosen avatar color
  myColor: ''
})

function loadColors (): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem('p2pcord:colors') || '{}')
  } catch {
    return {}
  }
}

// Friends' avatar colors are remembered, so offline friends keep theirs
function rememberColors () {
  let changed = false
  for (const [id, p] of Object.entries(ui.peers)) {
    const c = p.color || ''
    if ((ui.colors[id] || '') === c) continue
    if (c) ui.colors[id] = c
    else delete ui.colors[id]
    changed = true
  }
  if (changed) {
    try {
      localStorage.setItem('p2pcord:colors', JSON.stringify(ui.colors))
    } catch {}
  }
}

function loadReads (): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem('p2pcord:reads') || '{}')
  } catch {
    return {}
  }
}

function saveReads () {
  try {
    localStorage.setItem('p2pcord:reads', JSON.stringify(ui.reads))
  } catch {}
}

function loadOrder (): string[] {
  try {
    return JSON.parse(localStorage.getItem('p2pcord:order') || '[]')
  } catch {
    return []
  }
}

const chatKey = (space: string, channel: string) => space + ':' + channel

// ---- helpers ----

export function toast (text: string, kind: Toast['kind'] = 'info') {
  const id = Date.now() + Math.random()
  ui.toasts.push({ id, text, kind })
  setTimeout(() => {
    ui.toasts = ui.toasts.filter((t) => t.id !== id)
  }, kind === 'error' ? 6000 : 3500)
}

export function errorText (err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const known: Record<string, string> = {
    JOIN_TIMEOUT: 'Niemand aus der Gruppe war online, um dich reinzulassen. Versuch es später nochmal.',
    PAIRING_REJECTED: 'Beitritt abgelehnt.',
    INVITE_USED: 'Dieser Einladungscode wurde schon benutzt.',
    INVITE_EXPIRED: 'Dieser Einladungscode ist abgelaufen.',
    ALREADY_JOINING: 'Mit diesem Code trittst du bereits bei.',
    FILE_TOO_LARGE: 'Die Datei ist zu groß (max. 2 GB).',
    BACKEND_EXITED: 'Das Backend wurde beendet.',
    ABORTED: 'Abgebrochen.',
    NOT_ALLOWED: 'Dafür brauchst du Admin-Rechte.',
    BAD_IMAGE: 'Dieses Bildformat wird nicht unterstützt.',
    IMAGE_TOO_LARGE: 'Das Bild ist auch verkleinert noch zu groß.',
    VAULT_KEYRING: 'Der Schlüsselbund deines Systems konnte den P2Pcord-Tresor nicht entsperren. Melde dich neu an oder entsperre den Schlüsselbund (z. B. GNOME „Passwörter und Schlüssel“) und starte P2Pcord neu.',
    VAULT_LOCKED: 'Deine lokalen P2Pcord-Daten sind verschlüsselt, aber der passende Schlüssel fehlt. Wurde der Schlüsselbund zurückgesetzt? Deine Daten wurden nicht verändert.'
  }
  for (const k of Object.keys(known)) if (msg.includes(k)) return known[k]
  return msg
}

export function memberName (space: Space | undefined, identity: string): string {
  if (identity === ui.me) return ui.name || 'Du'
  const m = space?.members.find((x) => x.identity === identity)
  if (m) return m.name
  return ui.peers[identity]?.name || 'Unbekannt'
}

export function dmPartner (space: Space): Member | null {
  return space.members.find((m) => m.identity !== ui.me) || null
}

export function spaceTitle (space: Space): string {
  if (space.kind === KIND_DM) return dmPartner(space)?.name || 'Warte auf Freund…'
  return space.name || 'Gruppe'
}

export function isOnline (identity: string) {
  return identity === ui.me || !!ui.peers[identity]
}

export function unread (space: Space, channel: Channel): boolean {
  if (!channel.latest || channel.latest.author === ui.me) return false
  return channel.latest.ts > (ui.reads[chatKey(space.id, channel.id)] || 0)
}

export function spaceUnread (space: Space): boolean {
  return space.channels.some((c) => c.kind === TEXT && unread(space, c))
}

export function markRead (space: string, channel: string) {
  const s = ui.spaces[space]
  const ch = s?.channels.find((c) => c.id === channel)
  const ts = Math.max(ch?.latest?.ts || 0, Date.now())
  const key = chatKey(space, channel)
  if ((ui.reads[key] || 0) >= (ch?.latest?.ts || 0)) return
  ui.reads[key] = ts
  saveReads()
}

export function groups (): Space[] {
  const list = Object.values(ui.spaces).filter((s) => s.kind === KIND_GROUP)
  const pos = (id: string) => {
    const i = ui.order.indexOf(id)
    return i === -1 ? 1e9 : i
  }
  return list.sort((a, b) => pos(a.id) - pos(b.id) || a.created - b.created)
}

export function dms (): Space[] {
  const last = (s: Space) => Math.max(s.created, ...s.channels.map((c) => c.latest?.ts || 0))
  return Object.values(ui.spaces)
    .filter((s) => s.kind === KIND_DM)
    .sort((a, b) => last(b) - last(a))
}

// ---- navigation ----

export function openView (view: string) {
  ui.view = view
  if (view === 'home') {
    if (ui.chat && ui.spaces[ui.chat.space]?.kind === KIND_DM) return
    const first = dms()[0]
    if (first) openDm(first.id, false)
    else ui.chat = null
    return
  }
  const space = ui.spaces[view]
  if (!space) return
  const remembered = ui.lastChannel[view]
  const channel = space.channels.find((c) => c.id === remembered && c.kind === TEXT) || space.channels.find((c) => c.kind === TEXT)
  ui.chat = channel ? { space: view, channel: channel.id } : null
  if (channel) loadMessages(view, channel.id)
}

export function openChannel (space: string, channel: string) {
  ui.lastChannel[space] = channel
  ui.chat = { space, channel }
  ui.pane = 'chat'
  loadMessages(space, channel)
}

// show: switch to the chat on phones (false when opened automatically)
export function openDm (space: string, show = true) {
  const s = ui.spaces[space]
  const channel = s?.channels.find((c) => c.kind === TEXT)
  if (!channel) return
  ui.view = 'home'
  ui.chat = { space, channel: channel.id }
  if (show) ui.pane = 'chat'
  loadMessages(space, channel.id)
}

// ---- messages ----

export async function loadMessages (space: string, channel: string) {
  const key = chatKey(space, channel)
  const current = ui.messages[key]
  const limit = Math.max(50, current ? current.length : 0)
  try {
    const list = await call<Message[]>('listMessages', { id: space, channel, limit })
    ui.messages[key] = list
    if (current === undefined) ui.hasMore[key] = list.length >= limit
  } catch (err) {
    toast(errorText(err), 'error')
  }
}

export async function loadOlder (space: string, channel: string) {
  const key = chatKey(space, channel)
  const current = ui.messages[key] || []
  if (!current.length || ui.hasMore[key] === false) return false
  const older = await call<Message[]>('listMessages', { id: space, channel, before: current[0].id, limit: 50 })
  ui.messages[key] = [...older, ...current]
  ui.hasMore[key] = older.length >= 50
  return older.length > 0
}

export function messagesFor (space: string, channel: string): Message[] {
  return ui.messages[chatKey(space, channel)] || []
}

// ---- backend events ----

let notifySound: ((kind: string) => void) | null = null
export function setSoundPlayer (fn: (kind: string) => void) {
  notifySound = fn
}

function onSpace (state: Space) {
  const prev = ui.spaces[state.id]
  ui.spaces[state.id] = state
  if (!ui.order.includes(state.id) && state.kind === KIND_GROUP) {
    ui.order.push(state.id)
    localStorage.setItem('p2pcord:order', JSON.stringify(ui.order))
  }

  for (const ch of state.channels) {
    if (ch.kind !== TEXT) continue
    const was = prev?.channels.find((c) => c.id === ch.id)?.latest || null
    // rev also moves on edits, deletions and reactions, which leave ts alone
    if (was?.ts === ch.latest?.ts && was?.rev === ch.latest?.rev) continue
    const key = chatKey(state.id, ch.id)
    const open = ui.chat && ui.chat.space === state.id && ui.chat.channel === ch.id
    if (ui.messages[key] || open) loadMessages(state.id, ch.id)
    if (prev && ch.latest && ch.latest.ts > (was?.ts || 0) && ch.latest.author !== ui.me && (!open || !focused())) notify(state, ch)
  }

  if (ui.chat && ui.chat.space === state.id && !state.channels.some((c) => c.id === ui.chat!.channel)) {
    openView(ui.view)
  }
  // Nothing open on the home screen yet: show the newest conversation
  if (ui.status === 'ready' && ui.view === 'home' && !ui.chat && state.kind === KIND_DM) openDm(state.id, false)
}

// Phones: a visible app counts as focused (there is no window focus there)
function focused () {
  return bridge.info().mobile ? document.visibilityState === 'visible' : document.hasFocus()
}

function notify (space: Space, channel: Channel) {
  if (settings.mutedChats[space.id] || settings.mutedChats[space.id + ':' + channel.id]) return
  if (settings.sounds && notifySound) notifySound(space.kind === KIND_DM ? 'dm' : 'message')
  if (!settings.notifications || focused()) return
  try {
    const who = memberName(space, channel.latest!.author)
    const where = space.kind === KIND_DM ? who : `${space.name} · #${channel.name}`
    if (bridge.notify) {
      bridge.notify(where, space.kind === KIND_DM ? 'Neue Nachricht' : `${who}: Neue Nachricht`)
      return
    }
    const n = new Notification(where, { body: space.kind === KIND_DM ? 'Neue Nachricht' : `${who}: Neue Nachricht`, silent: true })
    n.onclick = () => {
      window.focus()
      if (space.kind === KIND_DM) openDm(space.id)
      else {
        ui.view = space.id
        openChannel(space.id, channel.id)
      }
    }
  } catch {}
}

export async function boot () {
  on('space', onSpace)
  on('space:removed', ({ id }) => {
    toast('Du wurdest aus einer Gruppe entfernt.', 'error')
    delete ui.spaces[id]
    if (ui.view === id) openView('home')
  })
  on('peers', (peers) => {
    ui.peers = peers
    rememberColors()
  })
  on('avatar', ({ identity, url }) => {
    if (url) ui.avatars[identity] = url
    else delete ui.avatars[identity]
  })
  on('fatal', (msg) => {
    ui.status = 'fatal'
    ui.error = errorText(msg)
  })
  on('exit', () => {
    ui.status = 'fatal'
    ui.error = 'Das P2P-Backend wurde unerwartet beendet.'
  })

  ui.order = loadOrder()
  await start()
  try {
    const init = await call('init')
    ui.me = init.identity
    ui.name = init.name
    ui.peers = init.peers
    ui.loadingSpaces = init.loading
    ui.vault = init.vault || 'none'
    ui.avatars = init.avatars || {}
    ui.myColor = init.color || ''
    rememberColors()
    for (const s of init.spaces) onSpace(s)
    ui.status = 'ready'
    openView(groups()[0]?.id || 'home')
  } catch (err) {
    ui.status = 'fatal'
    ui.error = errorText(err)
  }
}

// ---- actions ----

export async function setAvatar (data: string | null | undefined, mime?: string, color?: string) {
  const res = await call('setAvatar', { data, mime, color })
  if (res.url) ui.avatars[ui.me] = res.url
  else delete ui.avatars[ui.me]
  ui.myColor = res.color
}

export async function setName (name: string) {
  const res = await call('setName', { name })
  ui.name = res.name
}

export async function createGroup (name: string) {
  const state = await call<Space>('createSpace', { name, kind: KIND_GROUP })
  onSpace(state)
  openView(state.id)
  return state
}

export async function createDmInvite () {
  const state = await call<Space>('createSpace', { name: '', kind: KIND_DM })
  onSpace(state)
  openDm(state.id)
  const code = await call<string>('createInvite', { id: state.id, maxUses: 1 })
  return { space: state, code }
}

export async function join (code: string) {
  code = code.trim().replace(/^p2pcord:\/\/(invite\/)?/i, '')
  if (!code) return
  ui.joining.push(code)
  try {
    const state = await call<Space>('joinSpace', { code })
    onSpace(state)
    if (state.kind === KIND_DM) openDm(state.id)
    else openView(state.id)
    toast(state.kind === KIND_DM ? 'Freund hinzugefügt!' : `Du bist „${state.name}" beigetreten.`)
  } catch (err) {
    if (!String(err).includes('ABORTED')) toast(errorText(err), 'error')
  } finally {
    ui.joining = ui.joining.filter((c) => c !== code)
  }
}

export function cancelJoin (code: string) {
  return call('cancelJoin', { code })
}

export async function leave (space: string) {
  await call('leaveSpace', { id: space })
  delete ui.spaces[space]
  ui.order = ui.order.filter((id) => id !== space)
  localStorage.setItem('p2pcord:order', JSON.stringify(ui.order))
  openView(ui.view === space ? groups()[0]?.id || 'home' : ui.view)
}
