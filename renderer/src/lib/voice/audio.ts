// Microphone pipeline:
//   getUserMedia (48 kHz mono, WebRTC echo cancellation, browser NS off)
//     -> input gain -> AI noise suppression (DeepFilterNet3 | RNNoise | off)
//     -> voice gate worklet (level meter, VAD, lookahead) -> MediaStreamDestination
// The voice gate runs after the suppressor, so background noise never opens it,
// and on the audio thread, so a busy UI can never delay or chop the voice.
import { DeepFilterNet3Core } from 'deepfilternet3-noise-filter'
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseSimdUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'
import gateWorkletUrl from './gate.worklet.js?url'
import { settings, type NoiseMode } from '../settings.svelte'

const DFN3_ASSETS = new URL('dfn3', location.href).href.replace(/\/$/, '')
const SAMPLE_RATE = 48000
// The suppressors process 10 ms frames on the audio thread. With the smallest
// hardware buffer a slow frame means a dropout in what the others hear, so
// the context gets a bit of headroom whenever a suppressor may run.
const LATENCY_WITH_SUPPRESSOR = 0.04

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
  onchange: (() => void) | null = null

  private _ptt = false
  private source: MediaStreamAudioSourceNode | null = null
  private input: GainNode | null = null
  private suppressor: AudioNode | null = null
  private gate: AudioWorkletNode | null = null
  private dest: MediaStreamAudioDestinationNode | null = null
  private sync: ReturnType<typeof setInterval> | null = null
  private sent = ''

  get pttDown () {
    return this._ptt
  }

  set pttDown (down: boolean) {
    if (this._ptt === down) return
    this._ptt = down
    this.pushGate()
  }

  async start () {
    this.ctx = new AudioContext({
      sampleRate: SAMPLE_RATE,
      latencyHint: settings.noise === 'off' ? 'interactive' : LATENCY_WITH_SUPPRESSOR
    })
    await this.ctx.audioWorklet.addModule(gateWorkletUrl)
    this.input = this.ctx.createGain()
    this.gate = new AudioWorkletNode(this.ctx, 'p2pcord-voice-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    this.gate.port.onmessage = ({ data }) => this.onGate(data)
    // mono track: the stereo Opus mode negotiated for screen audio stays mono for voice
    this.dest = this.ctx.createMediaStreamDestination()
    this.dest.channelCount = 1
    this.dest.channelCountMode = 'explicit'
    this.gate.connect(this.dest)

    await this.openDevice()
    await this.setNoise(settings.noise)
    this.setInputGain(settings.inputGain)
    this.pushGate()
    // Safari and mobile WebViews may start the context suspended after the awaits above
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {})

    this.stream = this.dest.stream
    this.track = this.stream.getAudioTracks()[0]
    // settings (threshold, input mode) may change at any time; mute and PTT push immediately
    this.sync = setInterval(() => this.pushGate(), 200)
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
    if (node) this.input!.connect(node).connect(this.gate!)
    else this.input!.connect(this.gate!)
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
    this.pushGate()
  }

  private pushGate () {
    if (!this.gate) return
    const mode = this.muted ? 'closed' : settings.inputMode === 'ptt' ? (this._ptt ? 'open' : 'closed') : 'vad'
    const key = mode + ':' + settings.vadThreshold
    if (key === this.sent) return
    this.sent = key
    this.gate.port.postMessage({ mode, threshold: settings.vadThreshold })
  }

  private onGate ({ level, open }: { level: number; open: boolean }) {
    this.level = level
    const speaking = open && level > settings.vadThreshold - 6
    if (speaking !== this.speaking) {
      this.speaking = speaking
      this.onchange?.()
    }
  }

  async stop () {
    if (this.sync) clearInterval(this.sync)
    this.sync = null
    this.raw?.getTracks().forEach((t) => t.stop())
    this.track?.stop()
    if (this.suppressor instanceof RnnoiseWorkletNode) this.suppressor.destroy()
    if (this.gate) this.gate.port.onmessage = null
    await this.ctx?.close().catch(() => {})
    this.ctx = null
    this.raw = null
    this.stream = null
    this.track = null
    this.suppressor = null
    this.gate = null
    this.sent = ''
    this.speaking = false
    this.level = -100
  }
}

export { playSound } from './sounds'
