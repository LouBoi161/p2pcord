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
  screenQuality: '720p60' | '1080p30' | '1080p60' | '1440p30'
  stunServers: string[]
  turnUrl: string
  turnUser: string
  turnPass: string
  notifications: boolean
  sounds: boolean
  volumes: Record<string, number> // per identity, 0..1
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
  screenQuality: '1080p30',
  stunServers: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'],
  turnUrl: '',
  turnUser: '',
  turnPass: '',
  notifications: true,
  sounds: true,
  volumes: {}
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
