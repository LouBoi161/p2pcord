// Color themes and the two layouts (Discord-like, TeamSpeak-like).
// A theme only defines base colors; hover, borders, contrast text etc. are
// derived in app.css with color-mix(), so custom colors always fit together.
import { settings, saveSettings } from './settings.svelte'

export type Layout = 'discord' | 'teamspeak'

export interface ThemeColors {
  bgRail: string
  bgSidebar: string
  bgMain: string
  bgCall: string
  bgTile: string
  bgInput: string
  bgFloat: string
  bgPanel: string
  border: string
  text: string
  textMuted: string
  textFaint: string
  textStrong: string
  accent: string
  green: string
  red: string
  yellow: string
  link: string
}

export interface Theme {
  id: string
  name: string
  light?: boolean
  colors: ThemeColors
}

export const THEMES: Theme[] = [
  {
    id: 'discord',
    name: 'Discord Dunkel',
    colors: {
      bgRail: '#1e1f22', bgSidebar: '#2b2d31', bgMain: '#313338', bgCall: '#111214', bgTile: '#232428', bgInput: '#383a40',
      bgFloat: '#111214', bgPanel: '#232428', border: '#1f2023',
      text: '#dbdee1', textMuted: '#949ba4', textFaint: '#6d6f78', textStrong: '#f2f3f5',
      accent: '#5865f2', green: '#23a55a', red: '#da373c', yellow: '#f0b232', link: '#00a8fc'
    }
  },
  {
    id: 'teamspeak',
    name: 'TeamSpeak Nacht',
    colors: {
      bgRail: '#1b212b', bgSidebar: '#262e3b', bgMain: '#232a35', bgCall: '#161b23', bgTile: '#2c3544', bgInput: '#1c222c',
      bgFloat: '#171c24', bgPanel: '#1e2530', border: '#161b22',
      text: '#dfe5ee', textMuted: '#98a3b5', textFaint: '#66718a', textStrong: '#ffffff',
      accent: '#2176e8', green: '#3fbf7f', red: '#e5484d', yellow: '#f5b83d', link: '#3d9bff'
    }
  },
  {
    id: 'amoled',
    name: 'AMOLED Schwarz',
    colors: {
      bgRail: '#000000', bgSidebar: '#0a0a0b', bgMain: '#000000', bgCall: '#000000', bgTile: '#121214', bgInput: '#16161a',
      bgFloat: '#0d0d0f', bgPanel: '#08080a', border: '#1a1a1d',
      text: '#e2e2e6', textMuted: '#9a9aa3', textFaint: '#66666e', textStrong: '#ffffff',
      accent: '#7c83ff', green: '#2ec27e', red: '#ed333b', yellow: '#f6d32d', link: '#62a0ea'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    colors: {
      bgRail: '#242933', bgSidebar: '#2e3440', bgMain: '#353c4a', bgCall: '#1f232b', bgTile: '#2e3440', bgInput: '#3b4252',
      bgFloat: '#242933', bgPanel: '#292e39', border: '#232730',
      text: '#e5e9f0', textMuted: '#a3adbf', textFaint: '#6f7a8e', textStrong: '#eceff4',
      accent: '#88c0d0', green: '#a3be8c', red: '#bf616a', yellow: '#ebcb8b', link: '#81a1c1'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    colors: {
      bgRail: '#191a21', bgSidebar: '#21222c', bgMain: '#282a36', bgCall: '#15161c', bgTile: '#21222c', bgInput: '#343746',
      bgFloat: '#191a21', bgPanel: '#1d1e26', border: '#16171d',
      text: '#f8f8f2', textMuted: '#a4a8c4', textFaint: '#6272a4', textStrong: '#ffffff',
      accent: '#bd93f9', green: '#50fa7b', red: '#ff5555', yellow: '#f1fa8c', link: '#8be9fd'
    }
  },
  {
    id: 'forest',
    name: 'Wald',
    colors: {
      bgRail: '#141a16', bgSidebar: '#1b231e', bgMain: '#212b25', bgCall: '#0f1411', bgTile: '#1b231e', bgInput: '#2a352e',
      bgFloat: '#121814', bgPanel: '#171e1a', border: '#101511',
      text: '#dce5de', textMuted: '#93a398', textFaint: '#637268', textStrong: '#f1f6f2',
      accent: '#4caf7d', green: '#57c785', red: '#e0564f', yellow: '#e9b949', link: '#6fc3a0'
    }
  },
  {
    id: 'light',
    name: 'Hell',
    light: true,
    colors: {
      bgRail: '#e3e5e8', bgSidebar: '#f2f3f5', bgMain: '#ffffff', bgCall: '#ebedef', bgTile: '#dfe1e5', bgInput: '#ebedef',
      bgFloat: '#ffffff', bgPanel: '#ebedef', border: '#d9dadc',
      text: '#2e3338', textMuted: '#5c5e66', textFaint: '#80848e', textStrong: '#060607',
      accent: '#5865f2', green: '#1f8b4c', red: '#d83c3e', yellow: '#b57b0e', link: '#006ce7'
    }
  }
]

export const COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'accent', label: 'Akzent' },
  { key: 'bgRail', label: 'Gruppenleiste' },
  { key: 'bgSidebar', label: 'Kanalliste' },
  { key: 'bgMain', label: 'Chat' },
  { key: 'bgCall', label: 'Anruf' },
  { key: 'bgTile', label: 'Kacheln' },
  { key: 'bgInput', label: 'Eingabefeld' },
  { key: 'bgFloat', label: 'Menüs' },
  { key: 'text', label: 'Text' },
  { key: 'textMuted', label: 'Text gedämpft' },
  { key: 'textStrong', label: 'Überschriften' },
  { key: 'green', label: 'Grün (spricht, online)' },
  { key: 'red', label: 'Rot (auflegen, löschen)' },
  { key: 'link', label: 'Links' }
]

export function baseTheme (): Theme {
  return THEMES.find((t) => t.id === settings.theme) || THEMES[0]
}

export function themeColors (): ThemeColors {
  return { ...baseTheme().colors, ...settings.customColors }
}

const cssName = (key: string) => '--' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())

// Relative luminance decides whether text on the accent color is black or white
function luminance (hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return 0
  const n = parseInt(m[1], 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

export function applyTheme (root: HTMLElement = document.documentElement) {
  const colors = themeColors()
  for (const [key, value] of Object.entries(colors)) root.style.setProperty(cssName(key), value)
  root.style.setProperty('--on-accent', luminance(colors.accent) > 0.45 ? '#0b0c0e' : '#ffffff')
  const light = luminance(colors.bgMain) > 0.5
  root.style.setProperty('color-scheme', light ? 'light' : 'dark')
  root.dataset.scheme = light ? 'light' : 'dark'
  root.dataset.layout = settings.layout
  root.dataset.density = settings.messageStyle
  root.style.setProperty('--ui-scale', String(settings.uiScale))
}

export function setTheme (id: string) {
  settings.theme = id
  settings.customColors = {}
  saveSettings()
  applyTheme()
}

export function setColor (key: keyof ThemeColors, value: string) {
  settings.customColors[key] = value
  saveSettings()
  applyTheme()
}

export function resetColors () {
  settings.customColors = {}
  saveSettings()
  applyTheme()
}

// Choosing a layout also picks the matching defaults; everything stays adjustable
export function setLayout (layout: Layout, withDefaults = true) {
  settings.layout = layout
  if (withDefaults) {
    settings.messageStyle = layout === 'teamspeak' ? 'bubbles' : 'cozy'
    if (!Object.keys(settings.customColors).length) settings.theme = layout === 'teamspeak' ? 'teamspeak' : 'discord'
  }
  saveSettings()
  applyTheme()
}

// Shareable theme codes: base theme + custom colors as compact JSON
export function exportTheme (): string {
  return btoa(JSON.stringify({ t: settings.theme, c: settings.customColors }))
}

export function importTheme (code: string): boolean {
  try {
    const data = JSON.parse(atob(code.trim()))
    if (typeof data !== 'object' || !data) return false
    const theme = THEMES.find((t) => t.id === data.t)
    const custom: Partial<ThemeColors> = {}
    for (const f of COLOR_FIELDS) {
      const v = data.c?.[f.key]
      if (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)) custom[f.key] = v
    }
    settings.theme = theme ? theme.id : settings.theme
    settings.customColors = custom
    saveSettings()
    applyTheme()
    return true
  } catch {
    return false
  }
}
