import { mount } from 'svelte'
import './app.css'
import { bridge } from './lib/rpc'
import App from './App.svelte'
import { applyTheme } from './lib/theme.svelte'
import { settings, saveSettings } from './lib/settings.svelte'

const info = bridge.info()
if (info.mobile) {
  // Phones get one screen at a time (Discord-mobile style); the TeamSpeak
  // layout needs three columns, so it is not offered there
  const first = !localStorage.getItem('p2pcord:settings')
  settings.layout = 'discord'
  settings.designChosen = true
  // DeepFilterNet is heavy for a phone: RNNoise unless chosen otherwise
  if (first) settings.noise = 'rnnoise'
  saveSettings()
  document.documentElement.dataset.mobile = 'true'
  // iOS Safari has no contextmenu event on long press: synthesize one
  if (info.platform === 'web') installLongPress()
}

applyTheme()
if (settings.uiScale !== 1) bridge.setZoom(settings.uiScale)

mount(App, { target: document.getElementById('app')! })

function installLongPress () {
  let timer: ReturnType<typeof setTimeout> | null = null
  let start: { x: number; y: number } | null = null
  const cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    start = null
  }
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return cancel()
    const t = e.touches[0]
    const target = e.target as Element
    if (target.closest('input, textarea, [contenteditable="true"]')) return
    start = { x: t.clientX, y: t.clientY }
    timer = setTimeout(() => {
      timer = null
      if (!start) return
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: start.x, clientY: start.y })
      target.dispatchEvent(ev)
      start = null
    }, 500)
  }, { passive: true })
  document.addEventListener('touchmove', (e) => {
    if (!start) return
    const t = e.touches[0]
    if (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10) cancel()
  }, { passive: true })
  document.addEventListener('touchend', cancel, { passive: true })
  document.addEventListener('touchcancel', cancel, { passive: true })
}
