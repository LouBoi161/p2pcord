<script lang="ts">
  // Web app (iPhone): saved bridges and a backup of the account
  import Icon from './Icon.svelte'
  import { bridge } from '../lib/rpc'
  import { toast } from '../lib/state.svelte'
  import { web, addBridge, removeBridge, exportAccount } from '../lib/bridges/web.svelte'

  let code = $state('')
  let label = $state('')

  function add () {
    if (addBridge(code, label)) {
      code = ''
      label = ''
      toast('Brücke gespeichert')
    } else {
      toast('Das sieht nicht wie ein Brücken-Code aus.', 'error')
    }
  }

  function backup () {
    bridge.writeClipboard(exportAccount())
    toast('Sicherung kopiert – bewahre sie gut auf')
  }
</script>

<h1>Web-App & Brücken</h1>
<p class="hint">Verbunden über <strong>{web.via || 'eine Brücke'}</strong>. Mit mehreren Brücken bist du öfter erreichbar: Die App nimmt die erste, die online ist.</p>

<div class="list">
  {#each web.bridges as b (b.code)}
    <div class="item">
      <Icon name="monitor" size={18} />
      <span class="grow">{b.label}{b.label === web.via ? ' · verbunden' : ''}</span>
      <button class="icon" title="Entfernen" onclick={() => removeBridge(b.code)}><Icon name="trash" size={16} /></button>
    </div>
  {/each}
</div>

<div class="new">
  <input class="input" bind:value={code} placeholder="Brücken-Code (pb1-…)" autocomplete="off" autocapitalize="off" spellcheck="false" />
  <input class="input" bind:value={label} maxlength="40" placeholder="Von wem?" />
  <button class="btn" onclick={add} disabled={!code.trim()}>Hinzufügen</button>
</div>

<h2>Konto sichern</h2>
<p class="hint">
  Dein Konto (Schlüssel und Gruppen) liegt nur auf diesem Gerät. Wenn du die Web-App löschst oder Safari-Daten
  entfernst, ist es weg. Kopiere die Sicherung und bewahre sie privat auf – wer sie hat, kann sich als du ausgeben.
</p>
<button class="btn secondary" onclick={backup}>Sicherung kopieren</button>

<h2>Grenzen der Web-App</h2>
<ul class="hint">
  <li>Mindestens ein Freund mit Brücke muss P2Pcord am PC offen haben.</li>
  <li>Im Hintergrund und bei gesperrtem Bildschirm beendet iOS die Verbindung: keine Anrufe, keine Push-Benachrichtigungen.</li>
  <li>Bildschirm teilen geht auf dem iPhone nicht; zuschauen schon.</li>
  <li>Dateien bis 25 MB.</li>
</ul>

<style>
  .hint {
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.45;
    margin: 4px 0 12px;
  }
  h2 {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 28px 0 8px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: var(--bg-panel);
    border-radius: 8px;
  }
  .grow {
    flex: 1;
  }
  .icon {
    color: var(--text-muted);
    display: grid;
    place-items: center;
  }
  .new {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .new .input {
    flex: 1 1 160px;
    font-size: 16px;
  }
  ul.hint {
    padding-left: 18px;
  }
</style>
