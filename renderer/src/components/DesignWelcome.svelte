<script lang="ts">
  // Asked once (first start, or the first start after the update that added layouts)
  import LayoutPicker from './LayoutPicker.svelte'
  import Logo from './Logo.svelte'
  import { settings, saveSettings } from '../lib/settings.svelte'
  import { THEMES, setTheme } from '../lib/theme.svelte'

  let picked = $state(false)

  function done () {
    settings.designChosen = true
    saveSettings()
  }
</script>

<div class="backdrop">
  <div class="card" role="dialog" aria-modal="true" aria-label="Design wählen">
    <div class="logo"><Logo size={48} /></div>
    <h1>Wie soll P2Pcord aussehen?</h1>
    <p>Such dir den Aufbau aus, den du gewohnt bist. Du kannst das jederzeit unter Einstellungen → Darstellung ändern.</p>
    <LayoutPicker onpick={() => (picked = true)} />
    <div class="themes">
      <span>Farben:</span>
      {#each THEMES as t (t.id)}
        <button class="sw" class:active={settings.theme === t.id} title={t.name} style="background:{t.colors.bgMain}; --a:{t.colors.accent}" onclick={() => setTheme(t.id)}><i></i></button>
      {/each}
    </div>
    <div class="actions">
      <button class="btn" onclick={done}>{picked ? 'Fertig' : 'So lassen'}</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.7);
    animation: fade 0.2s ease-out;
    overflow-y: auto;
    padding: 16px;
  }
  .card {
    width: 620px;
    max-width: 100%;
    background: var(--bg-main);
    border-radius: 10px;
    padding: 28px;
    box-shadow: var(--shadow);
  }
  .logo {
    display: grid;
    place-items: center;
    margin-bottom: 8px;
  }
  h1 {
    text-align: center;
    color: var(--text-strong);
    font-size: 22px;
    margin: 0 0 6px;
  }
  p {
    text-align: center;
    color: var(--text-muted);
    margin: 0 0 20px;
  }
  .themes {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 18px;
    color: var(--text-muted);
    font-size: 13px;
  }
  .sw {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 2px solid var(--border-soft);
  }
  .sw i {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--a);
  }
  .sw.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--bg-main), 0 0 0 4px var(--accent);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 20px;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
