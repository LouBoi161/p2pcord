// Voice/video calls as a full WebRTC mesh. Signaling (SDP/ICE) travels over
// the Noise-authenticated Hyperswarm connection, so the DTLS fingerprints are
// bound to the peers' identities: media is end-to-end encrypted and cannot be
// intercepted by a man in the middle. No signaling server is involved.
import { call as rpc, on } from '../rpc'
import { ui, toast, errorText, KIND_DM, type Voice } from '../state.svelte'
import { settings, saveSettings, iceServers } from '../settings.svelte'
import { Mic, dbfs, playSound, createSuppressor } from './audio'
import { tuneOpus } from './sdp'

type Kind = 'mic' | 'cam' | 'screen'
export type ViewQuality = 'source' | '1080' | '720' | '480' | '360'

// Short side of the picture a viewer asks for; the streamer scales down per viewer
export const QUALITY_ORDER: ViewQuality[] = ['source', '1080', '720', '480', '360']
export const VIEW_QUALITIES: Record<ViewQuality, { label: string; short: number }> = {
  source: { label: 'Original', short: 0 },
  '1080': { label: '1080p', short: 1080 },
  '720': { label: '720p', short: 720 },
  '480': { label: '480p', short: 480 },
  '360': { label: '360p (Datensparmodus)', short: 360 }
}

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
  // Streams are opt-in: a remote screen is only sent to us while we watch it
  watching: {} as Record<string, boolean>,
  quality: {} as Record<string, ViewQuality>,
  viewers: {} as Record<string, boolean>, // who watches our own stream
  screenHasAudio: false,
  screenAudioOn: true,
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
  screenSource: MediaStream | null = null
  remoteView = { screen: false, quality: 'source' as ViewQuality }
  analyser: AnalyserNode | null = null
  source: MediaStreamAudioSourceNode | null = null
  restartTimer: ReturnType<typeof setTimeout> | null = null
  receivers = new Set<RTCRtpReceiver>()
  lostSignalled = false
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
    this.sendView()
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

  // Tells this peer whether we watch its stream and in which quality
  sendView () {
    this.send({ view: { screen: !!voice.watching[this.id], quality: voice.quality[this.id] || settings.viewerQuality } })
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
          const enc = p.encodings[0]
          enc.maxBitrate = audio ? (kind === 'screen' ? 160_000 : limits.mic) : limits[kind]
          enc.priority = kind === 'mic' ? 'high' : 'medium'
          enc.networkPriority = kind === 'mic' ? 'high' : 'medium'
          if (kind === 'screen') {
            // nothing goes out to peers that do not watch; the others get the size they asked for
            enc.active = this.remoteView.screen
            if (!audio) {
              const st = sender.track?.getSettings() || {}
              const short = Math.min(st.width || 1080, st.height || 1080)
              const want = VIEW_QUALITIES[this.remoteView.quality]?.short || 0
              const scale = want && short > want ? short / want : 1
              enc.scaleResolutionDownBy = scale
              enc.maxBitrate = Math.max(600_000, Math.round(limits.screen / (scale * scale)))
            }
          }
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
      if (data.view && typeof data.view === 'object') {
        const q = data.view.quality in VIEW_QUALITIES ? (data.view.quality as ViewQuality) : 'source'
        const watching = !!data.view.screen
        if (watching && !this.remoteView.screen && voice.screen) playSound('viewer')
        this.remoteView = { screen: watching, quality: q }
        if (watching) voice.viewers[this.id] = true
        else delete voice.viewers[this.id]
        await this.tuneSenders()
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
    if (e.track.kind === 'audio') this.receivers.add(e.receiver)
    this.applyBuffer()
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
        if (audio.length && this.screenSource !== stream) {
          this.screenSource = stream
          this.screenAudio.srcObject = new MediaStream(audio)
          this.screenAudio.play().catch(() => {})
        }
      }
    }
    r.cam = cam && cam.getVideoTracks().length ? cam : null
    r.screen = screen && screen.getVideoTracks().length ? screen : null
    if (!r.screen) {
      this.screenSource = null
      this.screenAudio.srcObject = null
    }
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

  // A larger minimum jitter buffer trades a little latency for fewer dropouts on shaky connections
  applyBuffer () {
    const target = settings.audioBuffer > 0 ? settings.audioBuffer : null
    for (const r of this.receivers) {
      try {
        if ((r as any).jitterBufferTarget !== target) (r as any).jitterBufferTarget = target
      } catch {}
    }
  }

  applyOutput () {
    this.applyBuffer()
    const clamp = (v: number) => Math.max(0, Math.min(1, v))
    this.audio.muted = voice.deaf || !!settings.localMutes[this.id]
    this.audio.volume = clamp(settings.volumes[this.id] ?? 1)
    this.screenAudio.muted = voice.deaf || !voice.watching[this.id] || !!settings.streamMutes[this.id]
    this.screenAudio.volume = clamp(settings.streamVolumes[this.id] ?? 1)
    for (const el of [this.audio, this.screenAudio]) {
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
    if (state === 'failed' && !this.lostSignalled) {
      this.lostSignalled = true
      playSound('disconnect')
    }
    if (state === 'connected') this.lostSignalled = false
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
    delete voice.viewers[this.id]
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
  startCallingTone()
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
  stopCallingTone()
  await mic.stop()
  voice.speaking = {}
  voice.focus = null
  voice.watching = {}
  voice.viewers = {}
  if (!switching) publish()
  playSound('leave')
}

// Calling a friend: a soft ringback tone until they pick up (at most a minute)
let callingTimer: ReturnType<typeof setInterval> | null = null
function startCallingTone () {
  stopCallingTone()
  const started = Date.now()
  const waiting = () => {
    const a = voice.active
    if (!a || ui.spaces[a.space]?.kind !== KIND_DM) return false
    return participants(a.space, a.channel).length < 2 && Date.now() - started < 60_000
  }
  if (!waiting()) return
  playSound('calling')
  callingTimer = setInterval(() => {
    if (waiting()) playSound('calling')
    else stopCallingTone()
  }, 3000)
}

function stopCallingTone () {
  if (callingTimer) clearInterval(callingTimer)
  callingTimer = null
}

export function toggleMute () {
  const wasDeaf = voice.deaf && voice.muted
  if (wasDeaf) {
    voice.deaf = false
    applyOutputs()
  }
  voice.muted = !voice.muted
  mic.setMuted(voice.muted)
  playSound(wasDeaf ? 'undeafen' : voice.muted ? 'mute' : 'unmute')
  publish()
}

export function toggleDeaf () {
  voice.deaf = !voice.deaf
  voice.muted = voice.deaf
  mic.setMuted(voice.muted)
  applyOutputs()
  playSound(voice.deaf ? 'deafen' : 'undeafen')
  publish()
}

export function applyOutputs () {
  for (const link of links.values()) link.applyOutput()
}

export function setVolume (identity: string, volume: number) {
  settings.volumes[identity] = volume
  links.get(identity)?.applyOutput()
}

export function toggleLocalMute (identity: string) {
  if (settings.localMutes[identity]) delete settings.localMutes[identity]
  else settings.localMutes[identity] = true
  saveSettings()
  links.get(identity)?.applyOutput()
}

// ---- watching other people's streams ----

export function isStreaming (identity: string) {
  return identity === ui.me ? !!voice.screen : !!voice.remote[identity]?.screen || !!ui.peers[identity]?.voice?.screen
}

export function watchStream (identity: string, on: boolean) {
  if (identity === ui.me) return
  if (on) voice.watching[identity] = true
  else {
    delete voice.watching[identity]
    if (voice.focus === identity + ':screen') voice.focus = null
  }
  const link = links.get(identity)
  link?.sendView()
  link?.applyOutput()
}

export function setStreamQuality (identity: string, quality: ViewQuality) {
  voice.quality[identity] = quality
  links.get(identity)?.sendView()
}

export function setStreamVolume (identity: string, volume: number) {
  settings.streamVolumes[identity] = volume
  links.get(identity)?.applyOutput()
}

export function toggleStreamMute (identity: string) {
  if (settings.streamMutes[identity]) delete settings.streamMutes[identity]
  else settings.streamMutes[identity] = true
  saveSettings()
  links.get(identity)?.applyOutput()
}

// Sender side: pause the sound of our own stream without stopping the picture
export function toggleStreamAudio () {
  voice.screenAudioOn = !voice.screenAudioOn
  for (const t of voice.screen?.getAudioTracks() || []) t.enabled = voice.screenAudioOn
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

// long side x short side: the budget is a pixel count, so portrait, 4:3 or
// ultrawide screens keep their shape and are not squeezed into a 16:9 box
const SCREEN_PRESETS: Record<string, { long: number; short: number; frameRate: number }> = {
  '720p60': { long: 1280, short: 720, frameRate: 60 },
  '1080p30': { long: 1920, short: 1080, frameRate: 30 },
  '1080p60': { long: 1920, short: 1080, frameRate: 60 },
  '1440p30': { long: 2560, short: 1440, frameRate: 30 }
}

export interface ScreenOptions {
  audio: boolean
  app?: string | null // Linux: only this application's sound (null = everything but P2Pcord)
}

let screenAudioLinked = false

// Linux: system audio comes from venmic's virtual microphone
async function linuxStreamAudio (app: string | null): Promise<MediaStreamTrack | null> {
  if (!(await window.p2p.streamAudio.available())) return null
  if (!(await window.p2p.streamAudio.start(app))) return null
  screenAudioLinked = true
  let device: MediaDeviceInfo | undefined
  for (let i = 0; i < 10 && !device; i++) {
    const list = await navigator.mediaDevices.enumerateDevices()
    device = list.find((d) => d.kind === 'audioinput' && d.label.includes('vencord-screen-share'))
    if (!device) await new Promise((resolve) => setTimeout(resolve, 150))
  }
  if (!device) return null
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: device.deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 2,
      sampleRate: 48000
    }
  })
  await window.p2p.streamAudio.unmute()
  return stream.getAudioTracks()[0] || null
}

// Called after the user picked a source in the picker (or directly on Wayland,
// where the system portal shows its own picker).
export async function startScreen (sourceId: string | null, opts: ScreenOptions = { audio: settings.streamAudio }) {
  if (!voice.active) return
  const preset = SCREEN_PRESETS[settings.screenQuality] || SCREEN_PRESETS['1080p30']
  const platform = window.p2p.info().platform
  try {
    await window.p2p.selectScreen(sourceId)
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: preset.long }, height: { max: preset.long }, frameRate: { ideal: preset.frameRate, max: preset.frameRate } },
      // Windows: system loopback, without our own call audio where Chromium supports that
      audio: opts.audio && platform === 'win32' ? ({ restrictOwnAudio: true, suppressLocalAudioPlayback: false } as any) : false
    })
    const track = stream.getVideoTracks()[0]
    track.contentHint = preset.frameRate >= 60 ? 'motion' : 'detail'
    track.onended = () => stopScreen()
    await fitPixels(track, preset.long * preset.short)
    if (opts.audio && platform === 'linux') {
      try {
        const audio = await linuxStreamAudio(opts.app ?? null)
        if (audio) stream.addTrack(audio)
        else toast('Stream-Ton ist auf diesem System nicht verfügbar (PipeWire nötig).')
      } catch (err) {
        toast('Stream-Ton konnte nicht gestartet werden: ' + errorText(err), 'error')
      }
    }
    beginScreen(stream)
  } catch (err) {
    if (screenAudioLinked) window.p2p.streamAudio.stop()
    screenAudioLinked = false
    if ((err as Error)?.name !== 'NotAllowedError') toast('Bildschirmübertragung fehlgeschlagen: ' + errorText(err), 'error')
  }
}

function beginScreen (stream: MediaStream) {
  voice.screenHasAudio = stream.getAudioTracks().length > 0
  voice.screenAudioOn = true
  voice.screen = stream
  voice.viewers = {}
  renegotiateAll('screen', stream)
  publish()
  playSound('stream-start')
}

// Scale a capture down to a pixel budget while keeping its aspect ratio
async function fitPixels (track: MediaStreamTrack, budget: number) {
  const { width, height } = track.getSettings()
  if (!width || !height || width * height <= budget * 1.02) return
  const f = Math.sqrt(budget / (width * height))
  try {
    await track.applyConstraints({ width: { max: Math.round(width * f) }, height: { max: Math.round(height * f) }, frameRate: track.getConstraints().frameRate })
  } catch {}
}

export function stopScreen (announce = true) {
  if (!voice.screen) return
  voice.screen.getTracks().forEach((t) => t.stop())
  voice.screen = null
  voice.screenHasAudio = false
  voice.viewers = {}
  if (screenAudioLinked) window.p2p.streamAudio.stop()
  screenAudioLinked = false
  renegotiateAll('screen', null)
  if (announce) {
    publish()
    playSound('stream-stop')
  }
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
  const down = e.type === 'keydown'
  if (down !== mic.pttDown && voice.active && !voice.muted) playSound(down ? 'ptt-on' : 'ptt-off')
  mic.pttDown = down
}

// ---- backend events ----

let prevParticipants = new Set<string>()
let prevLive = new Set<string>()
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
  on('peers', (peers) => {
    // this listener may run before the one in state.svelte.ts: never reconcile against stale presence
    ui.peers = peers
    reconcile()
    if (!voice.active) {
      prevParticipants = new Set()
      prevLive = new Set()
      return
    }
    const now = new Set(participants(voice.active.space, voice.active.channel))
    for (const id of now) if (!prevParticipants.has(id) && id !== ui.me && prevParticipants.size) playSound('peer-join')
    for (const id of prevParticipants) if (!now.has(id) && id !== ui.me) playSound('peer-leave')
    prevParticipants = now

    // someone in our call went live or stopped
    const live = new Set([...now].filter((id) => id !== ui.me && ui.peers[id]?.voice?.screen))
    for (const id of live) {
      if (prevLive.has(id)) continue
      playSound('stream-start')
      if (settings.autoWatch) watchStream(id, true)
    }
    for (const id of prevLive) {
      if (live.has(id)) continue
      if (now.has(id)) playSound('stream-stop')
      watchStream(id, false)
    }
    prevLive = live
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
if (window.p2p.info().debug) (window as any).__p2pVoice = { links, voice, mic, createSuppressor, ui, settings, beginScreen, watchStream, setStreamQuality }
