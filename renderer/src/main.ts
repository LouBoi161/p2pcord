import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { applyTheme } from './lib/theme.svelte'
import { settings } from './lib/settings.svelte'

applyTheme()
if (settings.uiScale !== 1) window.p2p.setZoom(settings.uiScale)

mount(App, { target: document.getElementById('app')! })
