<script lang="ts">
  import Icon from './Icon.svelte'
  import LayoutPicker from './LayoutPicker.svelte'
  import { settings, saveSettings } from '../lib/settings.svelte'
  import { THEMES, COLOR_FIELDS, themeColors, setTheme, setColor, resetColors, exportTheme, importTheme, applyTheme } from '../lib/theme.svelte'
  import { bridge } from '../lib/rpc'
  import { toast } from '../lib/state.svelte'

  let colors = $derived.by(() => {
    void settings.theme
    void settings.customColors
    return themeColors()
  })
  let custom = $derived(Object.keys(settings.customColors).length > 0)
  let code = $state('')

  function copyCode () {
    bridge.writeClipboard(exportTheme())
    toast('Theme-Code kopiert – schick ihn deinen Freunden!')
  }

  function applyCode () {
    if (importTheme(code)) {
      code = ''
      toast('Theme übernommen')
    } else toast('Das ist kein gültiger Theme-Code.', 'error')
  }

  function scale (v: number) {
    settings.uiScale = v
    saveSettings()
    bridge.setZoom(v)
  }
</script>

<h1>Darstellung</h1>

<div class="label">Layout</div>
<LayoutPicker />
<p class="hint">Beim Wechsel werden passende Standardwerte gesetzt (Theme, Nachrichtenstil). Alles lässt sich danach einzeln ändern.</p>

<h2>Theme</h2>
<div class="themes">
  {#each THEMES as t (t.id)}
    <button class="theme" class:active={settings.theme === t.id && !custom} onclick={() => setTheme(t.id)} title={t.name}>
      <span class="swatch" style="background:{t.colors.bgMain}">
        <i style="background:{t.colors.bgRail}"></i>
        <i style="background:{t.colors.bgSidebar}"></i>
        <b style="background:{t.colors.accent}"></b>
      </span>
      <span class="tname">{t.name}</span>
    </button>
  {/each}
</div>

<h2>Eigene Farben</h2>
<p class="hint">Ausgehend von „{THEMES.find((t) => t.id === settings.theme)?.name}“. Hover, Rahmen und Kontraste passen sich automatisch an.</p>
<div class="colors">
  {#each COLOR_FIELDS as f (f.key)}
    <label class="color">
      <input type="color" value={colors[f.key]} oninput={(e) => setColor(f.key, (e.target as HTMLInputElement).value)} />
      <span>{f.label}</span>
      {#if settings.customColors[f.key]}<i class="dot" title="geändert"></i>{/if}
    </label>
  {/each}
</div>
<div class="row">
  <button class="btn secondary small" onclick={resetColors} disabled={!custom}>Zurücksetzen</button>
  <button class="btn secondary small" onclick={copyCode}><Icon name="copy" size={14} /> Theme-Code kopieren</button>
</div>
<div class="row">
  <input class="input" bind:value={code} placeholder="Theme-Code einfügen" onkeydown={(e) => e.key === 'Enter' && applyCode()} />
  <button class="btn small" onclick={applyCode} disabled={!code.trim()}>Übernehmen</button>
</div>

<h2>Nachrichten</h2>
<div class="grid3">
  {#each [['cozy', 'Gemütlich', 'Profilbild und Name über jeder Nachrichtengruppe (Discord)'], ['bubbles', 'Sprechblasen', 'Jede Nachricht in einer Blase, Name mit Datum (TeamSpeak 6)'], ['compact', 'Kompakt', 'Eine Zeile pro Nachricht: 12:34 Name: Text']] as [id, name, desc] (id)}
    <button class="option" class:active={settings.messageStyle === id} onclick={() => { settings.messageStyle = id as any; saveSettings(); applyTheme() }}>
      <div><strong>{name}</strong><span>{desc}</span></div>
    </button>
  {/each}
</div>

<h2>Größe</h2>
<label class="field">
  <span>Zoom · {Math.round(settings.uiScale * 100)} %</span>
  <input type="range" min="0.75" max="1.5" step="0.05" value={settings.uiScale} onchange={(e) => scale(+(e.target as HTMLInputElement).value)} />
</label>
<p class="hint">Auch mit Strg + Plus/Minus, Strg + 0 setzt zurück.</p>

<style>
  .label {
    margin-bottom: 8px;
  }
  h2 {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 28px 0 10px;
    padding-top: 20px;
    border-top: 1px solid var(--border-soft);
  }
  h1 {
    font-size: 20px;
    color: var(--text-strong);
    margin: 0 0 20px;
  }
  .hint {
    margin: 8px 0;
  }
  .themes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .theme {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border-radius: 8px;
    outline: 2px solid transparent;
    color: var(--text-muted);
    font-size: 13px;
  }
  .theme:hover {
    background: var(--bg-hover);
  }
  .theme.active {
    outline-color: var(--accent);
    color: var(--text-strong);
  }
  .swatch {
    position: relative;
    height: 56px;
    border-radius: 6px;
    display: flex;
    overflow: hidden;
    border: 1px solid var(--border-soft);
  }
  .swatch i {
    width: 16px;
  }
  .swatch i + i {
    width: 34px;
  }
  .swatch b {
    position: absolute;
    right: 8px;
    bottom: 8px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
  }
  .colors {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: 8px;
  }
  .color {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--bg-sidebar);
    cursor: pointer;
    font-size: 14px;
  }
  .color input {
    width: 30px;
    height: 30px;
    border: 0;
    padding: 0;
    background: none;
    cursor: pointer;
  }
  .color span {
    flex: 1;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
  }
  .row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    align-items: center;
  }
  .row .input {
    flex: 1;
    height: 34px;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
  }
  .option {
    display: flex;
    align-items: center;
    gap: 12px;
    text-align: left;
    padding: 12px 14px;
    border-radius: 6px;
    background: var(--bg-sidebar);
    color: var(--text-muted);
  }
  .option div {
    display: flex;
    flex-direction: column;
  }
  .option strong {
    color: var(--text);
  }
  .option span {
    font-size: 13px;
  }
  .option:hover {
    background: var(--bg-active);
  }
  .option.active {
    outline: 2px solid var(--accent);
    background: var(--bg-active);
  }
</style>
