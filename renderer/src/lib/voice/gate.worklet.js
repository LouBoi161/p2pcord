// Voice gate on the audio thread. It replaces a gain node that was switched
// from a main-thread timer: that one reacted up to a few tens of milliseconds
// late (clipping the start of words) and stuttered whenever the UI was busy.
//
// - Lookahead: the signal is delayed by LOOKAHEAD, the level is measured on the
//   undelayed input, so the gate is already open when a word arrives.
// - Hysteresis: opening needs the threshold, staying open only threshold - 6 dB,
//   plus a hold time, so quiet word endings and short pauses are not cut.
// - Smooth ramps instead of hard switching (no clicks).
const LOOKAHEAD = 0.03 // s
const ATTACK = 0.004 // s
const RELEASE = 0.12 // s
const HOLD = 0.45 // s
const HYSTERESIS = 6 // dB
const REPORT_EVERY = 4 // render quanta (~10 ms)

class VoiceGate extends AudioWorkletProcessor {
  constructor () {
    super()
    this.threshold = -52
    this.mode = 'vad' // 'vad' | 'open' | 'closed'
    this.delay = new Float32Array(Math.ceil(LOOKAHEAD * sampleRate) + 128)
    this.write = 0
    this.lookahead = Math.ceil(LOOKAHEAD * sampleRate)
    this.gain = 0
    this.lastVoice = -1
    this.env = 0 // smoothed power
    this.peak = -100
    this.blocks = 0
    this.attack = 1 - Math.exp(-1 / (ATTACK * sampleRate))
    this.release = 1 - Math.exp(-1 / (RELEASE * sampleRate))
    this.port.onmessage = ({ data }) => {
      if (typeof data.threshold === 'number') this.threshold = data.threshold
      if (typeof data.mode === 'string') this.mode = data.mode
    }
  }

  process (inputs, outputs) {
    const input = inputs[0] && inputs[0][0]
    const output = outputs[0] && outputs[0][0]
    if (!output) return true
    const n = output.length

    let sum = 0
    if (input) for (let i = 0; i < n; i++) sum += input[i] * input[i]
    // ~10 ms power envelope, measured before the delay line
    this.env += (sum / n - this.env) * 0.25
    const level = this.env > 1e-10 ? 10 * Math.log10(this.env) : -100
    if (level > this.peak) this.peak = level

    const now = currentTime
    let open
    if (this.mode === 'open') open = true
    else if (this.mode === 'closed') open = false
    else {
      const gateOpen = this.gain > 0.5
      if (level > this.threshold || (gateOpen && level > this.threshold - HYSTERESIS)) this.lastVoice = now
      open = this.lastVoice >= 0 && now - this.lastVoice < HOLD
    }

    const target = open ? 1 : 0
    const coef = open ? this.attack : this.release
    const len = this.delay.length
    for (let i = 0; i < n; i++) {
      this.delay[this.write] = input ? input[i] : 0
      let read = this.write - this.lookahead
      if (read < 0) read += len
      this.write = (this.write + 1) % len
      this.gain += (target - this.gain) * coef
      output[i] = this.delay[read] * this.gain
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(output)

    if (++this.blocks >= REPORT_EVERY) {
      this.port.postMessage({ level: this.peak, open })
      this.peak = -100
      this.blocks = 0
    }
    return true
  }
}

registerProcessor('p2pcord-voice-gate', VoiceGate)
