<script lang="ts">
  // Desktop: lets friends with an iPhone use P2Pcord through this app
  import Icon from './Icon.svelte'
  import { bridge } from '../lib/rpc'
  import { toast } from '../lib/state.svelte'
  import { host, setBridgeEnabled, createBridgeCode, revokeBridgeCode, bridgeLink, WEB_APP_URL } from '../lib/bridge-host.svelte'

  let label = $state('')
  let fresh = $state<string | null>(null)

  function create () {
    const entry = createBridgeCode(label)
    label = ''
    fresh = entry.code
  }

  function copy (text: string, what: string) {
    bridge.writeClipboard(text)
    toast(what + ' kopiert')
  }

  function when (ts: number) {
    if (!ts) return 'noch nie verbunden'
    return 'zuletzt ' + new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  }
</script>

<h1>iPhone-Brücke</h1>
<p class="hint">
  iPhones können nicht direkt ins P2P-Netz. Mit einer Brücke nutzen Freunde mit iPhone P2Pcord als Web-App: Sie
  verbinden sich verschlüsselt mit <strong>dieser</strong> App, die für sie online geht. Ihr Konto (Schlüssel,
  Gruppen) bleibt auf ihrem iPhone und liegt hier nur verschlüsselt. Anrufe laufen direkt von ihrem iPhone zu den
  anderen.
</p>

<div class="card row">
  <div class="grow">
    <strong>Brücke aktiv</strong>
    <p class="hint">
      {#if host.enabled && host.codes.length}
        Wartet auf iPhones · {host.relays} von 5 Relays verbunden
      {:else if host.enabled}
        Erstelle unten einen Code für deinen Freund.
      {:else}
        Aus – niemand kann sich verbinden.
      {/if}
    </p>
  </div>
  <label class="switch">
    <input type="checkbox" checked={host.enabled} onchange={(e) => setBridgeEnabled(e.currentTarget.checked)} />
    <span></span>
  </label>
</div>

<h2>Codes</h2>
<p class="hint">Ein Code pro Person. Wer den Code hat, kann sich über dich verbinden – gib ihn nur deinem Freund.</p>
<div class="new">
  <input class="input" bind:value={label} maxlength="40" placeholder="Für wen? (z. B. „Max iPhone“)" onkeydown={(e) => e.key === 'Enter' && create()} />
  <button class="btn" onclick={create}>Code erstellen</button>
</div>

{#each host.codes as c (c.code)}
  <div class="card code-card" class:fresh={fresh === c.code}>
    <div class="row">
      <span class="dot" class:on={host.online[c.code]} title={host.online[c.code] ? 'Verbunden' : 'Nicht verbunden'}></span>
      <div class="grow">
        <strong>{c.label}</strong>
        <p class="hint">{host.online[c.code] ? 'gerade verbunden' : when(c.last)}</p>
      </div>
      <button class="btn secondary small" onclick={() => copy(bridgeLink(c.code), 'Link')}>Link kopieren</button>
      <button class="icon danger" title="Code widerrufen" onclick={() => revokeBridgeCode(c.code)}><Icon name="trash" size={18} /></button>
    </div>
    {#if fresh === c.code}
      <div class="steps">
        <p>Schick deinem Freund diesen Link. Auf dem iPhone:</p>
        <ol>
          <li>Link in <strong>Safari</strong> öffnen</li>
          <li><strong>Teilen</strong> → <strong>Zum Home-Bildschirm</strong></li>
          <li>P2Pcord vom Home-Bildschirm starten (fragt der Code, einfach einfügen)</li>
        </ol>
        <div class="mono selectable">{bridgeLink(c.code)}</div>
      </div>
    {/if}
  </div>
{/each}

<h2>Gut zu wissen</h2>
<ul class="hint list">
  <li>Die Brücke funktioniert nur, solange P2Pcord hier läuft.</li>
  <li>Du hilfst beim Verbinden und leitest die Anruf-Aushandlung weiter. Während dein Freund verbunden ist, laufen seine Nachrichten entschlüsselt durch deine App – er muss dir also vertrauen, so wie du einem Server vertrauen würdest.</li>
  <li>Gefunden wird deine App über öffentliche Nostr-Relays. Die sehen nur verschlüsselte Daten und ein zufälliges Thema.</li>
  <li>Widerrufen löscht alles, was dieser Freund hier gespeichert hatte.</li>
  <li>Web-App: <span class="mono">{WEB_APP_URL}</span></li>
</ul>

<style>
  .hint {
    color: var(--text-muted);
    font-size: 14px;
    line-height: 1.45;
    margin: 4px 0 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .grow {
    flex: 1;
    min-width: 0;
  }
  .grow .hint {
    margin: 2px 0 0;
  }
  .card {
    background: var(--bg-panel);
    border-radius: var(--radius);
    padding: 14px 16px;
    margin-bottom: 10px;
  }
  .card.fresh {
    outline: 2px solid var(--accent);
  }
  h2 {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 28px 0 8px;
  }
  .new {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }
  .new .input {
    flex: 1;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--text-faint);
    flex: none;
  }
  .dot.on {
    background: var(--green);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    color: var(--text-muted);
  }
  .icon.danger:hover {
    color: var(--red);
    background: var(--bg-hover);
  }
  .steps {
    margin-top: 12px;
    font-size: 14px;
  }
  .steps p {
    margin: 0 0 6px;
  }
  .steps ol {
    margin: 0 0 10px;
    padding-left: 22px;
    line-height: 1.6;
  }
  .mono {
    font-family: var(--mono);
    font-size: 12px;
    word-break: break-all;
    background: var(--bg-code);
    padding: 8px 10px;
    border-radius: 6px;
  }
  .list {
    padding-left: 18px;
  }
  .list li {
    margin-bottom: 6px;
  }
  .list .mono {
    padding: 2px 6px;
  }
  .switch {
    position: relative;
    width: 40px;
    height: 24px;
    flex: none;
  }
  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .switch span {
    position: absolute;
    inset: 0;
    border-radius: 12px;
    background: var(--bg-secondary);
    transition: background 0.15s;
    cursor: pointer;
  }
  .switch span::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .switch input:checked + span {
    background: var(--green);
  }
  .switch input:checked + span::after {
    transform: translateX(16px);
  }
</style>
