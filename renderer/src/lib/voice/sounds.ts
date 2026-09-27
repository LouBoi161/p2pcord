// UI sounds, synthesized on the fly: no audio files, three sound sets, each
// event with its own little motif so you can tell them apart without looking.
import { settings } from '../settings.svelte'

export type SoundPack = 'classic' | 'soft' | 'retro'

export const SOUND_EVENTS: { id: string; label: string; defaultOn?: boolean }[] = [
  { id: 'join', label: 'Du trittst einem Sprachkanal bei' },
  { id: 'leave', label: 'Du verlässt den Sprachkanal' },
  { id: 'peer-join', label: 'Jemand kommt in deinen Kanal' },
  { id: 'peer-leave', label: 'Jemand verlässt deinen Kanal' },
  { id: 'mute', label: 'Stummschalten / Stummschaltung aufheben' },
  { id: 'deafen', label: 'Ton aus / Ton an' },
  { id: 'message', label: 'Neue Nachricht in einer Gruppe' },
  { id: 'dm', label: 'Neue Direktnachricht' },
  { id: 'ring', label: 'Eingehender Anruf' },
  { id: 'calling', label: 'Freizeichen, während du anrufst' },
  { id: 'stream-start', label: 'Jemand geht live / Stream endet' },
  { id: 'viewer', label: 'Jemand schaut deinen Stream' },
  { id: 'disconnect', label: 'Verbindung zu jemandem verloren' },
  { id: 'ptt', label: 'Push-to-Talk drücken/loslassen', defaultOn: false }
]

// which settings switch a sound belongs to
const GROUP: Record<string, string> = {
  unmute: 'mute',
  undeafen: 'deafen',
  'stream-stop': 'stream-start',
  'ptt-on': 'ptt',
  'ptt-off': 'ptt'
}

export function soundEnabled (id: string) {
  const v = settings.soundEvents[id]
  if (v !== undefined) return v
  return SOUND_EVENTS.find((e) => e.id === id)?.defaultOn ?? true
}

// [semitones relative to A4, start (s), length (s), velocity 0..1]
type Note = [number, number, number, number]

const MOTIFS: Record<string, Note[]> = {
  join: [[3, 0, 0.14, 0.8], [7, 0.08, 0.14, 0.8], [10, 0.16, 0.3, 0.9]],
  leave: [[10, 0, 0.14, 0.8], [7, 0.08, 0.14, 0.8], [3, 0.16, 0.3, 0.8]],
  'peer-join': [[7, 0, 0.12, 0.6], [12, 0.09, 0.24, 0.7]],
  'peer-leave': [[12, 0, 0.12, 0.6], [7, 0.09, 0.24, 0.6]],
  mute: [[-2, 0, 0.1, 0.7], [-7, 0.06, 0.14, 0.6]],
  unmute: [[-7, 0, 0.1, 0.6], [-2, 0.06, 0.14, 0.7]],
  deafen: [[-5, 0, 0.12, 0.7], [-9, 0.08, 0.12, 0.6], [-12, 0.16, 0.2, 0.6]],
  undeafen: [[-12, 0, 0.12, 0.6], [-9, 0.08, 0.12, 0.6], [-5, 0.16, 0.2, 0.7]],
  message: [[12, 0, 0.16, 0.5], [19, 0.07, 0.3, 0.45]],
  dm: [[19, 0, 0.12, 0.5], [14, 0.08, 0.12, 0.5], [19, 0.16, 0.34, 0.5]],
  ring: [[7, 0, 0.18, 0.7], [11, 0.12, 0.18, 0.7], [14, 0.24, 0.18, 0.7], [11, 0.36, 0.18, 0.7], [14, 0.48, 0.45, 0.8]],
  calling: [[-2, 0, 0.9, 0.45], [2, 0, 0.9, 0.3]],
  'stream-start': [[3, 0, 0.1, 0.6], [10, 0.06, 0.1, 0.6], [15, 0.12, 0.1, 0.7], [22, 0.18, 0.3, 0.7]],
  'stream-stop': [[22, 0, 0.1, 0.6], [15, 0.06, 0.1, 0.6], [10, 0.12, 0.1, 0.6], [3, 0.18, 0.3, 0.6]],
  viewer: [[15, 0, 0.08, 0.45], [22, 0.05, 0.16, 0.4]],
  disconnect: [[7, 0, 0.16, 0.7], [3, 0.12, 0.16, 0.7], [0, 0.24, 0.4, 0.7]],
  'ptt-on': [[27, 0, 0.03, 0.35]],
  'ptt-off': [[22, 0, 0.03, 0.3]]
}

interface Voice {
  wave: OscillatorType
  partials: [number, number][] // [frequency ratio, level]
  attack: number
  decay: number // exponential decay time constant
  cutoff: number // lowpass
  level: number
}

const PACKS: Record<SoundPack, Voice> = {
  // clean bell: fundamental plus a soft octave and a slightly inharmonic shimmer
  classic: { wave: 'sine', partials: [[1, 1], [2, 0.28], [3.01, 0.08]], attack: 0.006, decay: 0.16, cutoff: 9000, level: 0.2 },
  // marimba-like: round, short, quiet
  soft: { wave: 'sine', partials: [[1, 1], [3.99, 0.18]], attack: 0.004, decay: 0.09, cutoff: 3500, level: 0.22 },
  // 8-bit beeps, filtered so they do not hurt
  retro: { wave: 'square', partials: [[1, 1]], attack: 0.002, decay: 0.12, cutoff: 2600, level: 0.07 }
}

let ctx: AudioContext | null = null
let master: GainNode | null = null
let sink = ''

function output () {
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: 'interactive' })
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    master = ctx.createGain()
    master.connect(comp).connect(ctx.destination)
  }
  // follow the chosen output device, like the call audio does
  const want = settings.outputDevice === 'default' ? '' : settings.outputDevice
  if (want !== sink && 'setSinkId' in ctx) {
    sink = want
    ;(ctx as any).setSinkId(want).catch(() => {})
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  master!.gain.value = settings.soundVolume
  return { ctx, master: master! }
}

function note (c: AudioContext, dest: AudioNode, v: Voice, freq: number, t: number, len: number, vel: number) {
  const env = c.createGain()
  const filter = c.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = v.cutoff
  env.gain.setValueAtTime(0, t)
  env.gain.linearRampToValueAtTime(v.level * vel, t + v.attack)
  env.gain.setTargetAtTime(0, t + v.attack, Math.min(v.decay, len))
  env.connect(filter).connect(dest)
  for (const [ratio, level] of v.partials) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = v.wave
    osc.frequency.value = freq * ratio
    g.gain.value = level
    osc.connect(g).connect(env)
    osc.start(t)
    osc.stop(t + len + v.decay * 6)
  }
}

export function playSound (kind: string, force = false) {
  if (!force && (!settings.sounds || !soundEnabled(GROUP[kind] || kind))) return
  const motif = MOTIFS[kind]
  if (!motif) return
  try {
    const { ctx: c, master: m } = output()
    const v = PACKS[settings.soundPack] || PACKS.classic
    const t0 = c.currentTime + 0.01
    for (const [semi, start, len, vel] of motif) note(c, m, v, 440 * 2 ** (semi / 12), t0 + start, len, vel)
  } catch {}
}
