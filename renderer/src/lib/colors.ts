// Per-person colors: the one they picked, else a stable one derived from the identity key
import { ui } from './state.svelte'

const palette = ['#5865f2', '#3ba55c', '#eb459e', '#faa81a', '#ed4245', '#1abc9c', '#9b59b6', '#e67e22', '#3498db', '#747f8d']

export const AVATAR_COLORS = palette

export function avatarColor (id: string) {
  return palette[parseInt((id || '0').slice(0, 6), 16) % palette.length] || palette[0]
}

export function personColor (id: string) {
  return (id === ui.me ? ui.myColor : ui.colors[id]) || avatarColor(id)
}

// Name color in compact chat, lifted towards the text color so it stays readable
export function nameColor (id: string) {
  return `color-mix(in srgb, ${personColor(id)} 70%, var(--text-strong))`
}
