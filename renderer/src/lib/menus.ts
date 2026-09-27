// Context menu contents for the things you can right-click in the app.
import { bridge, call } from './rpc'
import { openMenu, type MenuEntry } from './menu.svelte'
import { settings, saveSettings } from './settings.svelte'
import {
  ui,
  toast,
  memberName,
  dmPartner,
  dms,
  openDm,
  markRead,
  spaceTitle,
  TEXT,
  VOICE,
  KIND_DM,
  ROLE_ADMIN,
  type Space,
  type Channel
} from './state.svelte'
import {
  voice,
  joinVoice,
  leaveVoice,
  toggleMute,
  toggleDeaf,
  setVolume,
  toggleLocalMute,
  isStreaming,
  watchStream,
  setStreamQuality,
  setStreamVolume,
  toggleStreamMute,
  toggleStreamAudio,
  stopScreen,
  stopCamera,
  VIEW_QUALITIES,
  QUALITY_ORDER,
} from './voice/call.svelte'
import { popOut } from './popout.svelte'

export function copy (text: string, what = 'Kopiert') {
  bridge.writeClipboard(text)
  toast(what + '!')
}

const pct = (v: number) => Math.round(v * 100) + ' %'

function dmWith (identity: string): Space | undefined {
  return dms().find((s) => dmPartner(s)?.identity === identity)
}

function inMyCall (identity: string) {
  return !!voice.active && !!ui.peers[identity]?.voice && ui.peers[identity].voice!.space === voice.active.space && ui.peers[identity].voice!.channel === voice.active.channel
}

// Items for watching someone's stream, shared by the user and the stream menu
function streamItems (identity: string): MenuEntry[] {
  if (identity === ui.me) {
    if (!voice.screen) return []
    return [
      { type: 'header', label: 'Dein Stream' },
      voice.screenHasAudio && { label: voice.screenAudioOn ? 'Stream-Ton pausieren' : 'Stream-Ton fortsetzen', icon: voice.screenAudioOn ? 'volume-x' : 'volume', action: toggleStreamAudio },
      { label: 'Übertragung beenden', icon: 'monitor-off', danger: true, action: () => stopScreen() }
    ]
  }
  if (!isStreaming(identity) || !inMyCall(identity)) return []
  const watching = !!voice.watching[identity]
  const quality = voice.quality[identity] || settings.viewerQuality
  return [
    { type: 'header', label: 'Stream' },
    { label: watching ? 'Nicht mehr zuschauen' : 'Stream ansehen', icon: watching ? 'eye-off' : 'eye', action: () => watchStream(identity, !watching) },
    watching && { label: 'In eigenem Fenster öffnen', icon: 'external-link', action: () => popOut(identity) },
    watching && {
      type: 'sub',
      label: 'Qualität für mich',
      items: QUALITY_ORDER.map((q) => ({
        label: VIEW_QUALITIES[q].label,
        checked: quality === q,
        action: () => setStreamQuality(identity, q)
      }))
    },
    watching && {
      type: 'slider',
      label: 'Stream-Lautstärke',
      value: settings.streamVolumes[identity] ?? 1,
      min: 0,
      max: 1,
      step: 0.01,
      format: pct,
      oninput: (v) => setStreamVolume(identity, v),
      onchange: saveSettings
    },
    watching && { label: 'Stream stummschalten', checked: !!settings.streamMutes[identity], action: () => toggleStreamMute(identity) }
  ]
}

export function userMenu (e: MouseEvent, identity: string, spaceId?: string) {
  const space = spaceId ? ui.spaces[spaceId] : undefined
  const name = memberName(space, identity)
  const me = identity === ui.me

  if (me) {
    openMenu(e, [
      { type: 'header', label: name },
      { label: 'Profil bearbeiten', icon: 'edit', action: () => (ui.dialog = { type: 'settings', tab: 'profile' }) },
      voice.active && { type: 'sep' },
      voice.active && { label: 'Stummschalten', checked: voice.muted, action: toggleMute },
      voice.active && { label: 'Ton aus', checked: voice.deaf, action: toggleDeaf },
      voice.camera && { label: 'Kamera aus', icon: 'video-off', action: () => stopCamera() },
      ...streamItems(identity),
      { type: 'sep' },
      { label: 'ID kopieren', icon: 'copy', action: () => copy(identity, 'ID kopiert') }
    ])
    return
  }

  const dm = dmWith(identity)
  const call_ = inMyCall(identity)
  openMenu(e, [
    { type: 'header', label: name },
    { label: 'Profil', icon: 'users', action: () => (ui.dialog = { type: 'profile', identity, space: spaceId }) },
    dm && { label: 'Nachricht senden', icon: 'chat', action: () => openDm(dm.id) },
    dm && voice.active?.space !== dm.id && {
      label: 'Anrufen',
      icon: 'phone',
      action: () => {
        const vc = dm.channels.find((c) => c.kind === VOICE)
        if (vc) joinVoice(dm.id, vc.id)
      }
    },
    call_ && { type: 'sep' },
    call_ && {
      type: 'slider',
      label: 'Lautstärke',
      value: settings.volumes[identity] ?? 1,
      min: 0,
      max: 1,
      step: 0.01,
      format: pct,
      oninput: (v) => setVolume(identity, v),
      onchange: saveSettings
    },
    call_ && { label: 'Für mich stummschalten', checked: !!settings.localMutes[identity], action: () => toggleLocalMute(identity) },
    ...(call_ ? [{ type: 'sep' } as const, ...streamItems(identity)] : []),
    { type: 'sep' },
    { label: 'Sicherheitsnummer prüfen', icon: 'shield-check', action: () => (ui.dialog = { type: 'verify', identity, name }) },
    space && space.kind !== KIND_DM && space.role >= ROLE_ADMIN && { label: 'Mitglieder verwalten', icon: 'users', action: () => (ui.dialog = { type: 'members', space: space.id }) },
    { label: 'ID kopieren', icon: 'copy', action: () => copy(identity, 'ID kopiert') }
  ])
}

export function streamMenu (e: MouseEvent, identity: string) {
  openMenu(e, [...streamItems(identity), { type: 'sep' }, { label: 'Vollbild', icon: 'maximize', action: () => fullscreenTile(identity + ':screen') }])
}

export function fullscreenTile (key: string) {
  const el = document.querySelector(`[data-tile="${CSS.escape(key)}"]`) as HTMLElement | null
  el?.requestFullscreen?.()
}

function muteKey (space: Space, channel?: Channel) {
  return channel ? space.id + ':' + channel.id : space.id
}

export function isChatMuted (spaceId: string, channelId?: string) {
  return !!settings.mutedChats[spaceId] || (!!channelId && !!settings.mutedChats[spaceId + ':' + channelId])
}

function toggleChatMute (key: string) {
  if (settings.mutedChats[key]) delete settings.mutedChats[key]
  else settings.mutedChats[key] = true
  saveSettings()
}

function markSpaceRead (space: Space) {
  for (const ch of space.channels) if (ch.kind === TEXT) markRead(space.id, ch.id)
}

export function channelMenu (e: MouseEvent, space: Space, channel: Channel) {
  const admin = space.role >= ROLE_ADMIN
  const key = muteKey(space, channel)
  const inside = voice.active?.space === space.id && voice.active.channel === channel.id
  openMenu(e, [
    { type: 'header', label: (channel.kind === TEXT ? '#' : '') + channel.name },
    channel.kind === TEXT && { label: 'Als gelesen markieren', icon: 'check-check', action: () => markRead(space.id, channel.id) },
    channel.kind === TEXT && { label: 'Benachrichtigungen stummschalten', checked: !!settings.mutedChats[key], action: () => toggleChatMute(key) },
    channel.kind === VOICE && !inside && { label: 'Beitreten', icon: 'volume', action: () => joinVoice(space.id, channel.id) },
    channel.kind === VOICE && inside && { label: 'Verlassen', icon: 'phone-off', action: () => leaveVoice() },
    admin && { type: 'sep' },
    admin && {
      label: 'Kanal löschen',
      icon: 'trash',
      danger: true,
      action: () =>
        (ui.dialog = {
          type: 'confirm',
          title: 'Kanal löschen',
          text: `Willst du ${channel.kind === TEXT ? '#' : ''}${channel.name} wirklich für alle löschen?`,
          danger: true,
          action: 'Löschen',
          run: () => call('removeChannel', { id: space.id, channel: channel.id })
        })
    }
  ])
}

export function spaceMenu (e: MouseEvent, space: Space) {
  const admin = space.role >= ROLE_ADMIN
  openMenu(e, [
    { type: 'header', label: space.name },
    { label: 'Als gelesen markieren', icon: 'check-check', action: () => markSpaceRead(space) },
    { label: 'Benachrichtigungen stummschalten', checked: !!settings.mutedChats[space.id], action: () => toggleChatMute(space.id) },
    { type: 'sep' },
    { label: 'Leute einladen', icon: 'user-plus', action: () => (ui.dialog = { type: 'invite', space: space.id }) },
    { label: 'Mitglieder', icon: 'users', action: () => (ui.dialog = { type: 'members', space: space.id }) },
    admin && { label: 'Kanal erstellen', icon: 'plus-circle', action: () => (ui.dialog = { type: 'channel', space: space.id }) },
    admin && { label: 'Gruppe umbenennen', icon: 'edit', action: () => (ui.dialog = { type: 'rename', space: space.id }) },
    { type: 'sep' },
    { label: 'Gruppe verlassen', icon: 'logout', danger: true, action: () => (ui.dialog = { type: 'leave', space: space.id }) }
  ])
}

export function dmMenu (e: MouseEvent, space: Space) {
  const partner = dmPartner(space)
  const vc = space.channels.find((c) => c.kind === VOICE)
  openMenu(e, [
    { type: 'header', label: spaceTitle(space) },
    partner && vc && voice.active?.space !== space.id && { label: 'Anrufen', icon: 'phone', action: () => joinVoice(space.id, vc.id) },
    { label: 'Als gelesen markieren', icon: 'check-check', action: () => markSpaceRead(space) },
    { label: 'Benachrichtigungen stummschalten', checked: !!settings.mutedChats[space.id], action: () => toggleChatMute(space.id) },
    partner && { label: 'Profil', icon: 'users', action: () => (ui.dialog = { type: 'profile', identity: partner.identity, space: space.id }) },
    partner && { label: 'Sicherheitsnummer prüfen', icon: 'shield-check', action: () => (ui.dialog = { type: 'verify', identity: partner.identity, name: partner.name }) },
    !partner && { label: 'Einladungscode anzeigen', icon: 'ticket', action: () => (ui.dialog = { type: 'invite', space: space.id }) },
    { type: 'sep' },
    { label: 'Freund entfernen', icon: 'user-x', danger: true, action: () => (ui.dialog = { type: 'leave', space: space.id }) }
  ])
}

