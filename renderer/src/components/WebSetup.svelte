<script lang="ts">
  // Web app (iPhone): pairing with a friend's desktop app, and the waiting screen
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import { web, addBridge, removeBridge, retryNow, isIOS, standalone, importAccount } from '../lib/bridges/web.svelte'

  let code = $state('')
  let label = $state('')
  let bad = $state(false)
  let restoring = $state(false)
  let backup = $state('')
  let backupError = $state('')

  function add () {
    bad = !addBridge(code, label)
    if (!bad) {
      code = ''
      label = ''
    }
  }

  function restore () {
    try {
      importAccount(backup)
      location.reload()
    } catch (err) {
      backupError = err instanceof Error ? err.message : String(err)
    }
  }
</script>

<div class="setup">
  <div class="card">
    <div class="logo"><Logo size={64} /></div>
    {#if web.status === 'unpaired'}
      <h1>P2Pcord im Browser</h1>
      <p>
        Dein iPhone kann nicht direkt ins P2P-Netz. Deshalb verbindest du dich über die P2Pcord-App eines Freundes am
        PC – die „Brücke“. Dein Freund erstellt dir unter <strong>Einstellungen → iPhone-Brücke</strong> einen Code.
      </p>
      {#if isIOS && !standalone}
        <div class="tip">
          <Icon name="share" size={18} />
          <span>Tipp: Tippe unten auf <strong>Teilen</strong> → <strong>Zum Home-Bildschirm</strong> und starte P2Pcord von dort. So bleibt dein Konto erhalten und die App läuft im Vollbild.</span>
        </div>
      {/if}
      <label class="field">
        <span>Brücken-Code oder Link</span>
        <input class="input" bind:value={code} placeholder="pb1-…" autocomplete="off" autocapitalize="off" spellcheck="false" onkeydown={(e) => e.key === 'Enter' && add()} />
      </label>
      <label class="field">
        <span>Von wem? (optional)</span>
        <input class="input" bind:value={label} maxlength="40" placeholder="z. B. Louis' PC" onkeydown={(e) => e.key === 'Enter' && add()} />
      </label>
      {#if bad}<p class="err">Das sieht nicht wie ein Brücken-Code aus.</p>{/if}
      <button class="btn" onclick={add} disabled={!code.trim()}>Verbinden</button>
      <button class="link" onclick={() => (restoring = !restoring)}>Konto aus einer Sicherung wiederherstellen</button>
      {#if restoring}
        <textarea class="input area" rows="4" bind:value={backup} placeholder="Sicherung hier einfügen"></textarea>
        {#if backupError}<p class="err">{backupError}</p>{/if}
        <button class="btn secondary" onclick={restore} disabled={!backup.trim()}>Wiederherstellen</button>
      {/if}
    {:else}
      <h1>{web.status === 'lost' ? 'Verbindung verloren' : web.status === 'offline' ? 'Keine Brücke erreichbar' : 'Verbinde…'}</h1>
      {#if web.status === 'connecting' || web.status === 'lost'}
        <span class="spinner big"></span>
        <p>{web.status === 'lost' ? 'Die Verbindung zur Brücke ist abgebrochen. Sobald sie wieder da ist, geht es automatisch weiter.' : 'Suche die P2Pcord-App deines Freundes…'}</p>
      {:else}
        <p>Gerade ist keine deiner Brücken online. Mindestens ein Freund muss P2Pcord am PC offen haben. Es wird automatisch weiter versucht.</p>
        {#if web.error}<p class="err">{web.error}</p>{/if}
        <button class="btn" onclick={retryNow}>Jetzt erneut versuchen</button>
      {/if}
      {#if web.status !== 'lost'}
        <div class="bridges">
          {#each web.bridges as b (b.code)}
            <div class="bridge">
              <Icon name="monitor" size={16} />
              <span class="grow">{b.label}</span>
              <button class="icon" title="Entfernen" onclick={() => removeBridge(b.code)}><Icon name="x" size={16} /></button>
            </div>
          {/each}
        </div>
        <details>
          <summary>Weitere Brücke hinzufügen</summary>
          <input class="input" bind:value={code} placeholder="pb1-…" autocomplete="off" autocapitalize="off" spellcheck="false" />
          <input class="input" bind:value={label} maxlength="40" placeholder="Von wem?" />
          {#if bad}<p class="err">Das sieht nicht wie ein Brücken-Code aus.</p>{/if}
          <button class="btn secondary" onclick={add} disabled={!code.trim()}>Hinzufügen</button>
        </details>
      {/if}
    {/if}
    <ul>
      <li><Icon name="lock" size={16} /> Die Verbindung zur Brücke ist Ende-zu-Ende verschlüsselt.</li>
      <li><Icon name="phone" size={16} /> Anrufe laufen direkt von deinem iPhone zu deinen Freunden.</li>
      <li><Icon name="bell" size={16} /> Im Hintergrund oder bei gesperrtem Bildschirm bist du offline – keine Anrufe, keine Benachrichtigungen.</li>
    </ul>
  </div>
</div>

<style>
  .setup {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    place-items: center;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 16px;
    background:
      radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--accent) 35%, transparent), transparent 50%),
      radial-gradient(circle at 80% 80%, color-mix(in srgb, var(--green) 25%, transparent), transparent 50%),
      var(--bg-rail);
  }
  .card {
    width: min(460px, 100%);
    background: var(--bg-main);
    border-radius: 10px;
    padding: 28px 24px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .logo {
    align-self: center;
  }
  h1 {
    margin: 0;
    text-align: center;
    color: var(--text-strong);
    font-size: 22px;
  }
  p {
    margin: 0;
    color: var(--text-muted);
    line-height: 1.45;
  }
  .tip {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    background: color-mix(in srgb, var(--accent) 18%, var(--bg-panel));
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 14px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .input {
    font-size: 16px; /* iOS zooms into smaller inputs */
  }
  .area {
    resize: vertical;
    font-family: var(--mono);
    font-size: 13px;
  }
  .err {
    color: var(--red-text);
    font-size: 14px;
  }
  .link {
    color: var(--link);
    font-size: 14px;
    align-self: flex-start;
  }
  .spinner.big {
    align-self: center;
    width: 28px;
    height: 28px;
  }
  .bridges {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bridge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--bg-panel);
  }
  .grow {
    flex: 1;
  }
  .icon {
    color: var(--text-muted);
    display: grid;
    place-items: center;
  }
  details {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  details[open] {
    display: flex;
  }
  details > * + * {
    margin-top: 8px;
  }
  summary {
    color: var(--link);
    cursor: pointer;
    font-size: 14px;
  }
  ul {
    list-style: none;
    padding: 12px 0 0;
    margin: 0;
    border-top: 1px solid var(--border-soft);
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--text-muted);
    font-size: 13px;
  }
  li {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
</style>
