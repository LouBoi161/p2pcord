// Voice/video calls as a full WebRTC mesh. Signaling (SDP/ICE) travels over
// the Noise-authenticated Hyperswarm connection, so the DTLS fingerprints are
// bound to the peers' identities: media is end-to-end encrypted and cannot be
// intercepted by a man in the middle. No signaling server is involved.
import { call as rpc, on } from '../rpc'
import { ui, toast, errorText, KIND_DM, type Voice } from '../state.svelte'
import { settings, iceServers } from '../settings.svelte'
import { Mic, dbfs, playSound, createSuppressor } from './audio'
import { tuneOpus } from './sdp'

type Kind = 'mic' | 'cam' | 'screen'

export interface RemoteMedia {
  cam: MediaStream | null
  screen: MediaStream | null
  state: RTCPeerConnectionState | 'new'
}

export const voice = $state({
  active: null as { space: string; channel: string } | null,
  muted: false,
  deaf: false,
  joining: false,
  camera: null as MediaStream | null,
  screen: null as MediaStream | null,
  speaking: {} as Record<string, boolean>,
  remote: {} as Record<string, RemoteMedia>,
  focus: null as string | null, // tile id shown large
  micLevel: -100,
  noiseActive: 'off' as string,
  incoming: null as { space: string; channel: string; from: string } | null
})

export const mic = new Mic()
mic.onchange = () => {
  voice.speaking[ui.me] = mic.speaking
  voice.noiseActive = mic.activeNoise
}

const links = new Map<string, Link>()
let levelTimer: ReturnType<typeof setInterval> | null = null
let analysisCtx: AudioContext | null = null

// ---- participants ----

export function participants (space: string, channel: string): string[] {
  const ids: string[] = []
  if (voice.active && voice.active.space === space && voice.active.channel === channel) ids.push(ui.me)
  for (const [id, peer] of Object.entries(ui.peers)) {
    if (peer.voice && peer.voice.space === space && peer.voice.channel === channel) ids.push(id)
  }
  return ids
}

export function peerVoice (identity: string): Voice | null {
  if (identity === ui.me) {
    return voice.active
      ? { ...voice.active, muted: voice.muted, deaf: voice.deaf, video: !!voice.camera, screen: !!voice.screen }
      : null
  }
  return ui.peers[identity]?.voice || null
}

function publish () {
  const v = voice.active
    ? { ...voice.active, muted: voice.muted, deaf: voice.deaf, video: !!voice.camera, screen: !!voice.screen }
    : null
  rpc('setVoice', v || {}).catch(() => {})
}

function reconcile () {
  const want = new Set<string>()
  if (voice.active) {
    for (const id of participants(voice.active.space, voice.active.channel)) if (id !== ui.me) want.add(id)
  }
  for (const [id, link] of links) if (!want.has(id)) link.close()
  for (const id of want) if (!links.has(id)) new Link(id)
}

// ---- one peer connection ----

class Link {
  id: string
  pc: RTCPeerConnection
  polite: boolean
  makingOffer = false
  ignoreOffer = false
  senders: Partial<Record<Kind, RTCRtpSender[]>> = {}
  remoteKinds: Record<string, Kind> = {}
  streams = new Map<string, MediaStream>()
  audio: HTMLAudioElement
  screenAudio: HTMLAudioElement
  analyser: AnalyserNode | null = null
  source: MediaStreamAudioSourceNode | null = null
  restartTimer: ReturnType<typeof setTimeout> | null = null
  queue: Promise<void> = Promise.resolve()

  constructor (id: string) {
    this.id = id
    this.polite = ui.me > id
    links.set(id, this)
    voice.remote[id] = { cam: null, screen: null, state: 'new' }

    this.audio = new Audio()
    this.audio.autoplay = true
    this.screenAudio = new Audio()
    this.screenAudio.autoplay = true
    this.applyOutput()

    this.pc = new RTCPeerConnection({ iceServers: iceServers(), bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' })
    this.pc.onnegotiationneeded = () => this.negotiate()
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.send({ candidate: candidate.toJSON() })
    }
    this.pc.ontrack = (e) => this.onTrack(e)
    this.pc.onconnectionstatechange = () => this.onState()

    this.sendKinds()
    if (mic.stream) this.addStream('mic', mic.stream)
    if (voice.camera) this.addStream('cam', voice.camera)
    if (voice.screen) this.addStream('screen', voice.screen)
  }

  send (data: any) {
    if (!voice.active) return
    rpc('signal', { to: this.id, space: voice.active.space, data: { channel: voice.active.channel, ...data } }).catch(() => {})
  }

  sendKinds () {
    const kinds: Record<string, Kind> = {}
    if (mic.stream) kinds[mic.stream.id] = 'mic'
    if (voice.camera) kinds[voice.camera.id] = 'cam'
    if (voice.screen) kinds[voice.screen.id] = 'screen'
    this.send({ kinds })
  }

  addStream (kind: Kind, stream: MediaStream) {
    this.removeStream(kind)
    this.senders[kind] = stream.getTracks().map((t) => this.pc.addTrack(t, stream))
    this.tuneSenders()
  }

  removeStream (kind: Kind) {
    for (const s of this.senders[kind] || []) {
      try {
        this.pc.removeTrack(s)
      } catch {}
    }
    delete this.senders[kind]
  }

  async tuneSenders () {
    const limits: Record<Kind, number> = {
      mic: settings.bitrate * 1000,
      cam: 1_500_000,
      screen: settings.screenQuality.includes('60') || settings.screenQuality === '1440p30' ? 8_000_000 : 5_000_000
    }
    for (const kind of Object.keys(this.senders) as Kind[]) {
      for (const sender of this.senders[kind] || []) {
        try {
          const p = sender.getParameters()
          if (!p.encodings || !p.encodings.length) continue
          const audio = sender.track?.kind === 'audio'
          p.encodings[0].maxBitrate = audio ? (kind === 'screen' ? 128_000 : limits.mic) : limits[kind]
          p.encodings[0].priority = kind === 'mic' ? 'high' : 'medium'
          p.encodings[0].networkPriority = kind === 'mic' ? 'high' : 'medium'
          if (!audio) (p as any).degradationPreference = kind === 'screen' && !settings.screenQuality.includes('60') ? 'maintain-resolution' : 'balanced'
          await sender.setParameters(p)
        } catch {}
      }
    }
  }

  async negotiate () {
    try {
      this.makingOffer = true
      const offer = await this.pc.createOffer()
      if (this.pc.signalingState !== 'stable') return
      offer.sdp = tuneOpus(offer.sdp || '', settings.bitrate)
      await this.pc.setLocalDescription(offer)
      this.send({ description: this.pc.localDescription!.toJSON() })
    } catch (err) {
      console.warn('negotiation failed', err)
    } finally {
      this.makingOffer = false
    }
  }

  // Signals must be applied strictly in order (candidates after descriptions)
  onSignal (data: any) {
    this.queue = this.queue.then(() => this.handleSignal(data))
  }

  private async handleSignal (data: any) {
    try {
      if (data.kinds) {
        this.remoteKinds = data.kinds
        this.classify()
        return
      }
      if (data.description) {
        const desc = data.description as RTCSessionDescriptionInit
        const collision = desc.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable')
        this.ignoreOffer = !this.polite && collision
        if (this.ignoreOffer) return
        await this.pc.setRemoteDescription(desc)
        if (desc.type === 'offer') {
          const answer = await this.pc.createAnswer()
          answer.sdp = tuneOpus(answer.sdp || '', settings.bitrate)
          await this.pc.setLocalDescription(answer)
          this.send({ description: this.pc.localDescription!.toJSON() })
        }
        this.tuneSenders()
        return
      }
      if (data.candidate) {
        try {
          await this.pc.addIceCandidate(data.candidate)
        } catch (err) {
          if (!this.ignoreOffer) throw err
        }
      }
    } catch (err) {
      console.warn('signal handling failed', err)
    }
  }

  onTrack (e: RTCTrackEvent) {
    const stream = e.streams[0] || new MediaStream([e.track])
    this.streams.set(stream.id, stream)
    e.track.onunmute = () => this.classify()
    stream.onremovetrack = () => {
      if (stream.getTracks().length === 0) this.streams.delete(stream.id)
      this.classify()
    }
    this.classify()
  }

  classify () {
    const r = voice.remote[this.id]
    if (!r) return
    let cam: MediaStream | null = null
    let screen: MediaStream | null = null
    for (const [id, stream] of this.streams) {
      const kind = this.remoteKinds[id]
      const live = stream.getTracks().filter((t) => t.readyState === 'live')
      if (!live.length) continue
      if (kind === 'mic' || (!kind && live.every((t) => t.kind === 'audio'))) this.attachMic(stream)
      else if (kind === 'cam') cam = stream
      else if (kind === 'screen') {
        screen = stream
        const audio = stream.getAudioTracks()
        if (audio.length && this.screenAudio.srcObject !== stream) this.screenAudio.srcObject = new MediaStream(audio)
      }
    }
    r.cam = cam && cam.getVideoTracks().length ? cam : null
    r.screen = screen && screen.getVideoTracks().length ? screen : null
    if (!r.screen) this.screenAudio.srcObject = null
  }

  attachMic (stream: MediaStream) {
    if (this.audio.srcObject === stream) return
    this.audio.srcObject = stream
    this.audio.play().catch(() => {})
    try {
      analysisCtx ??= new AudioContext()
      this.source?.disconnect()
      this.source = analysisCtx.createMediaStreamSource(stream)
      this.analyser = analysisCtx.createAnalyser()
      this.analyser.fftSize = 512
      this.source.connect(this.analyser)
    } catch {}
  }

  applyOutput () {
    const vol = settings.volumes[this.id] ?? 1
    for (const el of [this.audio, this.screenAudio]) {
      el.muted = voice.deaf
      el.volume = Math.max(0, Math.min(1, vol))
      const sink = settings.outputDevice === 'default' ? '' : settings.outputDevice
      if ((el as any).sinkId !== sink) (el as any).setSinkId?.(sink).catch(() => {})
    }
  }

  onState () {
    const state = this.pc.connectionState
    if (voice.remote[this.id]) voice.remote[this.id].state = state
    if (state === 'connected') {
      if (this.restartTimer) clearTimeout(this.restartTimer)
      this.restartTimer = null
      this.tuneSenders()
    }
    if ((state === 'failed' || state === 'disconnected') && !this.restartTimer) {
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null
        if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'disconnected') this.pc.restartIce()
      }, state === 'failed' ? 0 : 4000)
    }
  }

  close () {
    links.delete(this.id)
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.pc.close()
    this.source?.disconnect()
    this.audio.srcObject = null
    this.screenAudio.srcObject = null
    delete voice.remote[this.id]
    delete voice.speaking[this.id]
    if (voice.focus && voice.focus.startsWith(this.id)) voice.focus = null
  }
}

// ---- public API ----

let micListening = false

export async function joinVoice (space: string, channel: string) {
  if (voice.active && voice.active.space === space && voice.active.channel === channel) return
  if (voice.active) await leaveVoice(true)
  voice.joining = true
  try {
    await mic.start()
    mic.setMuted(voice.muted)
  } catch (err) {
    voice.joining = false
    toast('Kein Zugriff auf das Mikrofon: ' + errorText(err), 'error')
    return
  }
  voice.active = { space, channel }
  voice.joining = false
  checkIncoming()
  voice.noiseActive = mic.activeNoise
  publish()
  reconcile()
  playSound('join')
  levelTimer = setInterval(updateLevels, 60)
  if (!micListening) {
    micListening = true
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    window.addEventListener('blur', () => {
      mic.pttDown = false
    })
  }
}

export async function leaveVoice (switching = false) {
  if (!voice.active) return
  voice.active = null
  for (const link of [...links.values()]) link.close()
  stopCamera(false)
  stopScreen(false)
  if (levelTimer) clearInterval(levelTimer)
  levelTimer = null
  await mic.stop()
  voice.speaking = {}
  voice.focus = null
  if (!switching) publish()
  playSound('leave')
}

export function toggleMute () {
  if (voice.deaf && voice.muted) {
    voice.deaf = false
    applyOutputs()
  }
  voice.muted = !voice.muted
  mic.setMuted(voice.muted)
  playSound(voice.muted ? 'mute' : 'unmute')
  publish()
}

export function toggleDeaf () {
  voice.deaf = !voice.deaf
  voice.muted = voice.deaf
  mic.setMuted(voice.muted)
  applyOutputs()
  playSound(voice.deaf ? 'mute' : 'unmute')
  publish()
}

export function applyOutputs () {
  for (const link of links.values()) link.applyOutput()
}

export function setVolume (identity: string, volume: number) {
  settings.volumes[identity] = volume
  links.get(identity)?.applyOutput()
}

function renegotiateAll (kind: Kind, stream: MediaStream | null) {
  for (const link of links.values()) {
    link.sendKinds()
    if (stream) link.addStream(kind, stream)
    else link.removeStream(kind)
  }
}

function openCamera (deviceId: string) {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    }
  })
}

export async function startCamera () {
  if (!voice.active) return
  try {
    let stream: MediaStream
    try {
      stream = await openCamera(settings.videoDevice)
    } catch (err) {
      // the saved camera is gone (unplugged, other USB port, ...): fall back to the default one
      if (!settings.videoDevice || (err as Error)?.name !== 'NotFoundError' && (err as Error)?.name !== 'OverconstrainedError') throw err
      stream = await openCamera('')
    }
    stream.getVideoTracks()[0].contentHint = 'motion'
    voice.camera = stream
    renegotiateAll('cam', stream)
    publish()
  } catch (err) {
    const name = (err as Error)?.name
    if (name === 'NotFoundError') toast('Keine Kamera gefunden. Ist sie angeschlossen und von anderen Programmen freigegeben?', 'error')
    else if (name === 'NotReadableError') toast('Die Kamera wird gerade von einem anderen Programm benutzt.', 'error')
    else if (name === 'NotAllowedError') toast('Kein Zugriff auf die Kamera erlaubt.', 'error')
    else toast('Kamera nicht verfügbar: ' + errorText(err), 'error')
  }
}

export function stopCamera (announce = true) {
  if (!voice.camera) return
  voice.camera.getTracks().forEach((t) => t.stop())
  voice.camera = null
  renegotiateAll('cam', null)
  if (announce) publish()
}

const SCREEN_PRESETS: Record<string, { width: number; height: number; frameRate: number }> = {
  '720p60': { width: 1280, height: 720, frameRate: 60 },
  '1080p30': { width: 1920, height: 1080, frameRate: 30 },
  '1080p60': { width: 1920, height: 1080, frameRate: 60 },
  '1440p30': { width: 2560, height: 1440, frameRate: 30 }
}

// Called after the user picked a source in the picker (or directly on Wayland,
// where the system portal shows its own picker).
export async function startScreen (sourceId: string | null) {
  if (!voice.active) return
  const preset = SCREEN_PRESETS[settings.screenQuality] || SCREEN_PRESETS['1080p30']
  try {
    await window.p2p.selectScreen(sourceId)
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: preset.width }, height: { max: preset.height }, frameRate: { ideal: preset.frameRate, max: preset.frameRate } },
      audio: window.p2p.info().platform === 'win32' // system audio capture is Windows-only
    })
    const track = stream.getVideoTracks()[0]
    track.contentHint = preset.frameRate >= 60 ? 'motion' : 'detail'
    track.onended = () => stopScreen()
    voice.screen = stream
    renegotiateAll('screen', stream)
    publish()
  } catch (err) {
    if ((err as Error)?.name !== 'NotAllowedError') toast('Bildschirmübertragung fehlgeschlagen: ' + errorText(err), 'error')
  }
}

export function stopScreen (announce = true) {
  if (!voice.screen) return
  voice.screen.getTracks().forEach((t) => t.stop())
  voice.screen = null
  renegotiateAll('screen', null)
  if (announce) publish()
}

// Rebuild the mic chain after settings changed during a call
export async function refreshMic ({ device = false } = {}) {
  if (!voice.active || !mic.ctx) return
  if (device) await mic.openDevice()
  if (mic.activeNoise !== settings.noise) await mic.setNoise(settings.noise)
  mic.setNoiseLevel(settings.noiseLevel)
  mic.setInputGain(settings.inputGain)
}

const levelBuf = new Float32Array(512)
function updateLevels () {
  voice.micLevel = mic.level
  for (const [id, link] of links) {
    if (!link.analyser) continue
    const peer = ui.peers[id]
    const speaking = !peer?.voice?.muted && dbfs(link.analyser, levelBuf) > -55
    if (voice.speaking[id] !== speaking) voice.speaking[id] = speaking
  }
}

function onKey (e: KeyboardEvent) {
  if (settings.inputMode !== 'ptt' || e.code !== settings.pttKey) return
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  mic.pttDown = e.type === 'keydown'
}

// ---- backend events ----

let prevParticipants = new Set<string>()
const declined = new Set<string>() // `${from}:${space}` for the current call attempt
let ringTimer: ReturnType<typeof setInterval> | null = null

// A DM partner sitting in the DM's voice channel while we are not = incoming call
function checkIncoming () {
  let found: typeof voice.incoming = null
  for (const [id, peer] of Object.entries(ui.peers)) {
    const v = peer.voice
    if (!v) continue
    const space = ui.spaces[v.space]
    if (!space || space.kind !== KIND_DM) continue
    if (voice.active && voice.active.space === v.space) continue
    const key = id + ':' + v.space
    if (declined.has(key)) continue
    found = { space: v.space, channel: v.channel, from: id }
  }
  // forget declines once the caller hung up, so the next call rings again
  for (const key of [...declined]) {
    const [id, space] = key.split(':')
    if (ui.peers[id]?.voice?.space !== space) declined.delete(key)
  }
  voice.incoming = found
  if (found && !ringTimer) {
    playSound('ring')
    ringTimer = setInterval(() => playSound('ring'), 2200)
  } else if (!found && ringTimer) {
    clearInterval(ringTimer)
    ringTimer = null
  }
}

export function acceptCall () {
  const c = voice.incoming
  if (!c) return
  voice.incoming = null
  joinVoice(c.space, c.channel)
  checkIncoming()
}

export function declineCall () {
  const c = voice.incoming
  if (!c) return
  declined.add(c.from + ':' + c.space)
  checkIncoming()
}

export function initVoice () {
  // Re-evaluates whenever presence, spaces or our own call state change
  $effect.root(() => {
    $effect(checkIncoming)
  })
  on('peers', () => {
    reconcile()
    if (!voice.active) {
      prevParticipants = new Set()
      return
    }
    const now = new Set(participants(voice.active.space, voice.active.channel))
    for (const id of now) if (!prevParticipants.has(id) && id !== ui.me && prevParticipants.size) playSound('join')
    for (const id of prevParticipants) if (!now.has(id) && id !== ui.me) playSound('leave')
    prevParticipants = now
  })
  on('signal', ({ from, space, data }) => {
    if (!voice.active || voice.active.space !== space || !data || data.channel !== voice.active.channel) return
    let link = links.get(from)
    if (!link) link = new Link(from)
    link.onSignal(data)
  })
  window.addEventListener('beforeunload', () => {
    rpc('setVoice', {}).catch(() => {})
  })
}

// Debug handle for automated tests (dev builds started with P2PCORD_DEBUG_PORT only)
if (window.p2p.info().debug) (window as any).__p2pVoice = { links, voice, mic, createSuppressor, ui }
