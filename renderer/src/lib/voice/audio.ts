// Microphone pipeline:
//   getUserMedia (48 kHz mono, WebRTC echo cancellation, browser NS off)
//     -> input gain -> AI noise suppression (DeepFilterNet3 | RNNoise | off)
//     -> level meter / voice activity -> gate -> MediaStreamDestination
// The voice gate runs after the suppressor, so background noise never opens it.
import { DeepFilterNet3Core } from 'deepfilternet3-noise-filter'
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import { settings, type NoiseMode } from '../settings.svelte'

const DFN3_ASSETS = new URL('dfn3', location.href).href.replace(/\/$/, '')
const SAMPLE_RATE = 48000
const VAD_HOLD_MS = 350

let dfn3: DeepFilterNet3Core | null = null
let dfn3Loading: Promise<DeepFilterNet3Core> | null = null
let rnnoiseBinary: Promise<ArrayBuffer> | null = null

function loadDfn3 () {
  if (dfn3) return Promise.resolve(dfn3)
  if (!dfn3Loading) {
    const core = new DeepFilterNet3Core({
      sampleRate: SAMPLE_RATE,
      noiseReductionLevel: settings.noiseLevel,
      assetConfig: { cdnUrl: DFN3_ASSETS }
    })
    dfn3Loading = core.initialize().then(() => (dfn3 = core))
    dfn3Loading.catch(() => {
      dfn3Loading = null
    })
  }
  return dfn3Loading
}

export function dbfs (analyser: AnalyserNode, buf: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buf)
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  const rms = Math.sqrt(sum / buf.length)
  return rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100
}

export async function createSuppressor (ctx: BaseAudioContext, mode: NoiseMode): Promise<AudioNode | null> {
  if (mode === 'dfn3') {
    const core = await loadDfn3()
    const node = await core.createAudioWorkletNode(ctx as AudioContext)
    core.setSuppressionLevel(settings.noiseLevel)
    return node
  }
  if (mode === 'rnnoise') {
    rnnoiseBinary ??= loadRnnoise({ url: rnnoiseWasmUrl, simdUrl: rnnoiseSimdUrl })
    const wasmBinary = await rnnoiseBinary
    await ctx.audioWorklet.addModule(rnnoiseWorkletUrl)
    return new RnnoiseWorkletNode(ctx as AudioContext, { wasmBinary, maxChannels: 1 })
  }
  return null
}

export class Mic {
  ctx: AudioContext | null = null
  raw: MediaStream | null = null
  stream: MediaStream | null = null // processed output, what peers receive
  track: MediaStreamTrack | null = null
  activeNoise: NoiseMode = 'off'
  level = -100
  speaking = false
  muted = false
  pttDown = false
  onchange: (() => void) | null = null

  private source: MediaStreamAudioSourceNode | null = null
  private input: GainNode | null = null
  private suppressor: AudioNode | null = null
  private analyser: AnalyserNode | null = null
  private gate: GainNode | null = null
  private dest: MediaStreamAudioDestinationNode | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastVoice = 0
  private buf = new Float32Array(1024)

  async start () {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
    this.input = this.ctx.createGain()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.gate = this.ctx.createGain()
    this.gate.gain.value = 0
    this.dest = this.ctx.createMediaStreamDestination()
    this.analyser.connect(this.gate)
    this.gate.connect(this.dest)

    await this.openDevice()
    await this.setNoise(settings.noise)
    this.setInputGain(settings.inputGain)

    this.stream = this.dest.stream
    this.track = this.stream.getAudioTracks()[0]
    this.timer = setInterval(() => this.tick(), 20)
  }

  async openDevice () {
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: settings.inputDevice && settings.inputDevice !== 'default' ? { exact: settings.inputDevice } : undefined,
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noise === 'off', // browser NS only as last resort
        autoGainControl: settings.autoGain,
        channelCount: 1,
        sampleRate: SAMPLE_RATE
      }
    })
    const old = this.raw
    this.source?.disconnect()
    this.raw = raw
    this.source = this.ctx!.createMediaStreamSource(raw)
    this.source.connect(this.input!)
    old?.getTracks().forEach((t) => t.stop())
  }

  async setNoise (mode: NoiseMode) {
    let node: AudioNode | null = null
    try {
      node = await createSuppressor(this.ctx!, mode)
    } catch (err) {
      console.error('noise suppression failed, falling back', err)
    }
    if (!node) mode = 'off'

    this.input!.disconnect()
    if (this.suppressor) {
      this.suppressor.disconnect()
      if (this.suppressor instanceof RnnoiseWorkletNode) this.suppressor.destroy()
    }
    this.suppressor = node
    if (node) this.input!.connect(node).connect(this.analyser!)
    else this.input!.connect(this.analyser!)
    this.activeNoise = mode
    this.onchange?.()
  }

  setNoiseLevel (level: number) {
    dfn3?.setSuppressionLevel(level)
  }

  setInputGain (gain: number) {
    if (this.input) this.input.gain.value = gain
  }

  setMuted (muted: boolean) {
    this.muted = muted
    if (this.track) this.track.enabled = !muted
  }

  private tick () {
    if (!this.analyser || !this.gate || !this.ctx) return
    this.level = dbfs(this.analyser, this.buf)
    const now = performance.now()
    let open: boolean
    if (this.muted) open = false
    else if (settings.inputMode === 'ptt') open = this.pttDown
    else {
      if (this.level > settings.vadThreshold) this.lastVoice = now
      open = now - this.lastVoice < VAD_HOLD_MS
    }
    this.gate.gain.setTargetAtTime(open ? 1 : 0, this.ctx.currentTime, open ? 0.005 : 0.05)
    const speaking = open && this.level > settings.vadThreshold - 6
    if (speaking !== this.speaking) {
      this.speaking = speaking
      this.onchange?.()
    }
  }

  async stop () {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.raw?.getTracks().forEach((t) => t.stop())
    this.track?.stop()
    if (this.suppressor instanceof RnnoiseWorkletNode) this.suppressor.destroy()
    await this.ctx?.close().catch(() => {})
    this.ctx = null
    this.raw = null
    this.stream = null
    this.track = null
    this.suppressor = null
    this.speaking = false
    this.level = -100
  }
}

// Short UI sounds synthesized on the fly (no audio assets needed)
let sfxCtx: AudioContext | null = null
export function playSound (kind: string) {
  if (!settings.sounds) return
  try {
    sfxCtx ??= new AudioContext()
    const ctx = sfxCtx
    const tones: Record<string, number[]> = {
      join: [523, 784],
      leave: [784, 523],
      mute: [440],
      unmute: [660],
      message: [880, 1175],
      ring: [659, 784, 988, 784]
    }
    const seq = tones[kind] || [600]
    seq.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const t = ctx.currentTime + i * 0.09
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.08, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.18)
    })
  } catch {}
}
