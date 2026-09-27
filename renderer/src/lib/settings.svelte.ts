// Per-device preferences, stored locally only.

export type NoiseMode = 'dfn3' | 'rnnoise' | 'off'
export type InputMode = 'vad' | 'ptt'

export interface Settings {
  inputDevice: string
  outputDevice: string
  videoDevice: string
  noise: NoiseMode
  noiseLevel: number // 0..100 attenuation for DeepFilterNet3
  echoCancellation: boolean
  autoGain: boolean
  inputMode: InputMode
  vadThreshold: number // dBFS
  pttKey: string // KeyboardEvent.code
  inputGain: number // 0..2
  bitrate: number // kbps for voice
  audioBuffer: number // ms minimum jitter buffer for received audio, 0 = automatic
  screenQuality: '720p60' | '1080p30' | '1080p60' | '1440p30'
  stunServers: string[]
  turnUrl: string
  turnUser: string
  turnPass: string
  notifications: boolean
  sounds: boolean
  volumes: Record<string, number> // per identity, 0..1
  localMutes: Record<string, boolean> // people muted only for us
  streamVolumes: Record<string, number>
  streamMutes: Record<string, boolean>
  streamAudio: boolean // share sound with the screen
  autoWatch: boolean // open other people's streams without clicking
  viewerQuality: 'source' | '1080' | '720' | '480' | '360' // default quality we ask streamers for
  mutedChats: Record<string, boolean> // space id or space:channel -> no sound/notification
  callChat: boolean // chat next to (or below) an active call
  sidebarHidden: boolean
  collapsed: Record<string, boolean> // collapsed sidebar sections and channel trees
  layout: 'discord' | 'teamspeak'
  designChosen: boolean // asked once which layout the user wants
  theme: string
  customColors: Record<string, string>
  messageStyle: 'cozy' | 'compact' | 'bubbles' // compact: one line per message; bubbles: TeamSpeak 6 style
  uiScale: number
  soundVolume: number // 0..1
  soundPack: 'classic' | 'soft' | 'retro'
  soundEvents: Record<string, boolean> // false = this sound is off
}

const KEY = 'p2pcord:settings'

const DEFAULTS: Settings = {
  inputDevice: 'default',
  outputDevice: 'default',
  videoDevice: '',
  noise: 'dfn3',
  noiseLevel: 80,
  echoCancellation: true,
  autoGain: false,
  inputMode: 'vad',
  vadThreshold: -52,
  pttKey: 'KeyV',
  inputGain: 1,
  bitrate: 96,
  audioBuffer: 0,
  screenQuality: '1080p30',
  stunServers: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'],
  turnUrl: '',
  turnUser: '',
  turnPass: '',
  notifications: true,
  sounds: true,
  volumes: {},
  localMutes: {},
  streamVolumes: {},
  streamMutes: {},
  streamAudio: true,
  autoWatch: false,
  viewerQuality: 'source',
  mutedChats: {},
  callChat: true,
  sidebarHidden: false,
  collapsed: {},
  layout: 'discord',
  designChosen: false,
  theme: 'discord',
  customColors: {},
  messageStyle: 'cozy',
  uiScale: 1,
  soundVolume: 0.7,
  soundPack: 'classic',
  soundEvents: {}
}

function load (): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {}
  return { ...DEFAULTS }
}

export const settings: Settings = $state(load())

export function saveSettings () {
  try {
    localStorage.setItem(KEY, JSON.stringify($state.snapshot(settings)))
  } catch {}
}

export function iceServers (): RTCIceServer[] {
  const servers: RTCIceServer[] = []
  const stun = settings.stunServers.map((s) => s.trim()).filter(Boolean)
  if (stun.length) servers.push({ urls: stun })
  if (settings.turnUrl.trim()) {
    servers.push({ urls: settings.turnUrl.trim(), username: settings.turnUser, credential: settings.turnPass })
  }
  return servers
}
