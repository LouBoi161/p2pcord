<script lang="ts">
  import { onDestroy } from 'svelte'
  import Icon from './Icon.svelte'
  import Avatar from './Avatar.svelte'
  import { bridge } from '../lib/rpc'
  import { ui, setName, toast, errorText } from '../lib/state.svelte'
  import { settings, saveSettings } from '../lib/settings.svelte'
  import { Mic } from '../lib/voice/audio'
  import { voice, mic as liveMic, refreshMic, applyOutputs } from '../lib/voice/call.svelte'
  import { fingerprint } from '../lib/format'

  let { tab = 'profile', onclose }: { tab?: string; onclose: () => void } = $props()
  // svelte-ignore state_referenced_locally
  let current = $state(tab)

  let name = $state(ui.name)
  let inputs = $state<MediaDeviceInfo[]>([])
  let outputs = $state<MediaDeviceInfo[]>([])
  let cameras = $state<MediaDeviceInfo[]>([])
  let level = $state(-100)
  let testMic: Mic | null = null
  let testing = $state(false)
  let loopback: HTMLAudioElement | null = null
  let capturing = $state(false)
  let stunText = $state(settings.stunServers.join('\n'))
  const info = bridge.info()

  async function loadDevices () {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      inputs = list.filter((d) => d.kind === 'audioinput')
      outputs = list.filter((d) => d.kind === 'audiooutput')
      cameras = list.filter((d) => d.kind === 'videoinput')
    } catch {}
  }
  loadDevices()

  const meter = setInterval(() => {
    const m = voice.active ? liveMic : testMic
    level = m ? m.level : -100
  }, 50)

  onDestroy(() => {
    clearInterval(meter)
    stopTest()
    saveSettings()
  })

  async function startTest () {
    if (voice.active) return
    try {
      testMic = new Mic()
      await testMic.start()
      loopback = new Audio()
      loopback.srcObject = testMic.stream
      const sink = settings.outputDevice === 'default' ? '' : settings.outputDevice
      await (loopback as any).setSinkId?.(sink).catch(() => {})
      await loopback.play()
      testing = true
      loadDevices()
    } catch (err) {
      toast('Mikrofontest fehlgeschlagen: ' + errorText(err), 'error')
      stopTest()
    }
  }

  function stopTest () {
    testing = false
    if (loopback) loopback.srcObject = null
    loopback = null
    testMic?.stop()
    testMic = null
  }

  async function changed (what: 'device' | 'noise' | 'gain' | 'output' | 'other') {
    saveSettings()
    if (what === 'output') applyOutputs()
    if (voice.active) await refreshMic({ device: what === 'device' })
    if (testMic) {
      if (what === 'device') await testMic.openDevice()
      if (what === 'noise') await testMic.setNoise(settings.noise)
      testMic.setNoiseLevel(settings.noiseLevel)
      testMic.setInputGain(settings.inputGain)
    }
  }

  async function saveName () {
    try {
      await setName(name)
      toast('Name gespeichert')
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  function captureKey () {
    capturing = true
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code !== 'Escape') settings.pttKey = e.code
      capturing = false
      saveSettings()
      window.removeEventListener('keydown', handler, true)
    }
    window.addEventListener('keydown', handler, true)
  }

  function saveStun () {
    settings.stunServers = stunText.split(/\s+/).map((s) => s.trim()).filter(Boolean)
    saveSettings()
  }

  let pct = $derived(Math.max(0, Math.min(100, ((level + 90) / 90) * 100)))
  let thresholdPct = $derived(((settings.vadThreshold + 90) / 90) * 100)
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !capturing && onclose()} />

<div class="settings">
  <nav>
    <div class="nav-inner">
      <div class="group">Benutzereinstellungen</div>
      <button class:active={current === 'profile'} onclick={() => (current = 'profile')}>Mein Profil</button>
      <button class:active={current === 'security'} onclick={() => (current = 'security')}>Sicherheit</button>
      <div class="group">App-Einstellungen</div>
      <button class:active={current === 'voice'} onclick={() => (current = 'voice')}>Sprache & Video</button>
      <button class:active={current === 'notify'} onclick={() => (current = 'notify')}>Benachrichtigungen</button>
      <button class:active={current === 'network'} onclick={() => (current = 'network')}>Netzwerk</button>
      <div class="sep"></div>
      <div class="version">P2Pcord {info.version}</div>
    </div>
  </nav>

  <main class="thin-scroll">
    <div class="page">
      {#if current === 'profile'}
        <h1>Mein Profil</h1>
        <div class="profile">
          <Avatar id={ui.me} name={name || ui.name} size={80} />
          <div class="profile-fields">
            <label class="field">
              <span>Anzeigename</span>
              <input class="input" bind:value={name} maxlength="32" onkeydown={(e) => e.key === 'Enter' && saveName()} />
            </label>
            <button class="btn" onclick={saveName} disabled={!name.trim() || name === ui.name}>Speichern</button>
          </div>
        </div>
        <div class="card">
          <div class="label">Deine ID (öffentlicher Schlüssel)</div>
          <div class="code">{ui.me}</div>
          <p class="hint">Kurzform: <span class="mono">{fingerprint(ui.me)}</span></p>
        </div>
      {:else if current === 'security'}
        <h1>Sicherheit</h1>
        <div class="card list">
          <div class="item"><Icon name="key" size={20} /><div><strong>Kein Account, kein Passwort</strong><p>Deine Identität ist ein Ed25519-Schlüsselpaar, das nur auf diesem Gerät liegt.</p></div></div>
          {#if ui.vault === 'keyring'}
            <div class="item"><Icon name="lock" size={20} /><div><strong>Lokale Daten verschlüsselt</strong><p>Dein Schlüssel, die Gruppenschlüssel und deine Gruppenliste sind auf der Festplatte verschlüsselt. Der Tresor-Schlüssel liegt im Schlüsselbund deines Systems. Geöffnete Anhänge werden beim Beenden gelöscht.</p></div></div>
          {:else}
            <div class="item warn"><Icon name="lock" size={20} /><div><strong>Kein System-Schlüsselbund gefunden</strong><p>Deine lokalen Daten sind zwar verschlüsselt, aber der Tresor-Schlüssel liegt ungeschützt daneben. Installiere bzw. aktiviere einen Schlüsselbund (z. B. gnome-keyring oder KWallet) und starte P2Pcord neu.</p></div></div>
          {/if}
          <div class="item"><Icon name="lock" size={20} /><div><strong>Verschlüsselte Verbindungen</strong><p>Jede Verbindung zu einem Peer nutzt das Noise-Protokoll (Hyperswarm) und ist an dessen Schlüssel gebunden.</p></div></div>
          <div class="item"><Icon name="shield" size={20} /><div><strong>Verschlüsselte Daten</strong><p>Nachrichten und Dateien einer Gruppe sind mit dem Gruppenschlüssel verschlüsselt. Nur Mitglieder können sie lesen.</p></div></div>
          <div class="item"><Icon name="phone" size={20} /><div><strong>Ende-zu-Ende-Anrufe</strong><p>Audio und Video laufen direkt per WebRTC (DTLS-SRTP). Die Schlüssel werden über die authentifizierte P2P-Verbindung ausgehandelt.</p></div></div>
          <div class="item"><Icon name="ticket" size={20} /><div><strong>Blind Pairing</strong><p>Einladungscodes enthalten keine Schlüssel und lassen sich auf eine Nutzung und eine Ablaufzeit begrenzen.</p></div></div>
          <div class="item warn"><Icon name="signal" size={20} /><div><strong>Gut zu wissen</strong><p>Wie bei jeder P2P-App sehen verbundene Peers deine IP-Adresse. Wer aus einer Gruppe entfernt wird, behält, was er bereits empfangen hat.</p></div></div>
        </div>
      {:else if current === 'voice'}
        <h1>Sprache & Video</h1>
        <div class="grid2">
          <label class="field">
            <span>Eingabegerät</span>
            <select class="input" bind:value={settings.inputDevice} onchange={() => changed('device')}>
              <option value="default">Standard</option>
              {#each inputs.filter((d) => d.deviceId !== 'default' && d.deviceId) as d (d.deviceId)}
                <option value={d.deviceId}>{d.label || 'Mikrofon'}</option>
              {/each}
            </select>
          </label>
          <label class="field">
            <span>Ausgabegerät</span>
            <select class="input" bind:value={settings.outputDevice} onchange={() => changed('output')}>
              <option value="default">Standard</option>
              {#each outputs.filter((d) => d.deviceId !== 'default' && d.deviceId) as d (d.deviceId)}
                <option value={d.deviceId}>{d.label || 'Lautsprecher'}</option>
              {/each}
            </select>
          </label>
        </div>

        <label class="field">
          <span>Eingangslautstärke · {Math.round(settings.inputGain * 100)}%</span>
          <input type="range" min="0" max="2" step="0.05" bind:value={settings.inputGain} oninput={() => changed('gain')} />
        </label>

        <div class="field">
          <span>Mikrofontest</span>
          <div class="test">
            {#if voice.active}
              <p class="hint">Du bist gerade in einem Anruf – der Pegel zeigt dein Live-Mikrofon.</p>
            {:else if testing}
              <button class="btn secondary" onclick={stopTest}>Test beenden</button>
            {:else}
              <button class="btn" onclick={startTest}>Mikrofon testen</button>
            {/if}
            <div class="meter">
              <div class="fill" style="width:{pct}%" class:open={level > settings.vadThreshold}></div>
              {#if settings.inputMode === 'vad'}<div class="threshold" style="left:{thresholdPct}%"></div>{/if}
            </div>
          </div>
          {#if testing}<p class="hint">Du hörst dich selbst so, wie deine Freunde dich hören (mit Rauschfilter). Kopfhörer benutzen!</p>{/if}
        </div>

        <h2>Rauschunterdrückung</h2>
        <div class="options">
          <button class="option" class:active={settings.noise === 'dfn3'} onclick={() => { settings.noise = 'dfn3'; changed('noise') }}>
            <Icon name="sparkles" size={20} />
            <div><strong>DeepFilterNet3 (KI) – empfohlen</strong><span>Entfernt Tastatur, Lüfter, Hunde, Straßenlärm. Läuft lokal auf deinem Gerät.</span></div>
          </button>
          <button class="option" class:active={settings.noise === 'rnnoise'} onclick={() => { settings.noise = 'rnnoise'; changed('noise') }}>
            <Icon name="sparkles" size={20} />
            <div><strong>RNNoise (leicht)</strong><span>Sparsamer für schwache PCs, etwas weniger gründlich.</span></div>
          </button>
          <button class="option" class:active={settings.noise === 'off'} onclick={() => { settings.noise = 'off'; changed('noise') }}>
            <Icon name="mic" size={20} />
            <div><strong>Aus</strong><span>Nur die einfache Rauschunterdrückung des Browsers.</span></div>
          </button>
        </div>
        {#if settings.noise === 'dfn3'}
          <label class="field">
            <span>Stärke · {settings.noiseLevel}</span>
            <input type="range" min="10" max="100" step="5" bind:value={settings.noiseLevel} oninput={() => changed('other')} />
          </label>
        {/if}
        {#if voice.active && voice.noiseActive !== settings.noise}
          <p class="hint warn-text">Der gewählte Filter konnte nicht geladen werden, aktiv ist: {voice.noiseActive}.</p>
        {/if}

        <h2>Eingabemodus</h2>
        <div class="grid2">
          <button class="option" class:active={settings.inputMode === 'vad'} onclick={() => { settings.inputMode = 'vad'; saveSettings() }}>
            <div><strong>Sprachaktivierung</strong><span>Sendet, sobald du sprichst.</span></div>
          </button>
          <button class="option" class:active={settings.inputMode === 'ptt'} onclick={() => { settings.inputMode = 'ptt'; saveSettings() }}>
            <div><strong>Push-to-Talk</strong><span>Sendet nur, solange du die Taste hältst.</span></div>
          </button>
        </div>
        {#if settings.inputMode === 'vad'}
          <label class="field">
            <span>Empfindlichkeit · {settings.vadThreshold} dB</span>
            <input type="range" min="-80" max="-20" step="1" bind:value={settings.vadThreshold} onchange={() => saveSettings()} />
          </label>
        {:else}
          <div class="field">
            <span>Taste</span>
            <button class="btn secondary" onclick={captureKey}>{capturing ? 'Drück eine Taste…' : settings.pttKey}</button>
            <p class="hint">Push-to-Talk funktioniert, solange P2Pcord im Vordergrund ist.</p>
          </div>
        {/if}

        <h2>Qualität</h2>
        <div class="grid2">
          <label class="field">
            <span>Sprachqualität (Opus)</span>
            <select class="input" bind:value={settings.bitrate} onchange={() => saveSettings()}>
              <option value={64}>Standard – 64 kbps</option>
              <option value={96}>Hoch – 96 kbps</option>
              <option value={128}>Studio – 128 kbps</option>
            </select>
          </label>
          <label class="field">
            <span>Bildschirmübertragung</span>
            <select class="input" bind:value={settings.screenQuality} onchange={() => saveSettings()}>
              <option value="720p60">720p · 60 FPS</option>
              <option value="1080p30">1080p · 30 FPS</option>
              <option value="1080p60">1080p · 60 FPS</option>
              <option value="1440p30">1440p · 30 FPS</option>
            </select>
          </label>
        </div>
        <label class="check">
          <input type="checkbox" bind:checked={settings.echoCancellation} onchange={() => changed('device')} />
          <span>Echounterdrückung (bei Lautsprechern an lassen)</span>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={settings.autoGain} onchange={() => changed('device')} />
          <span>Automatische Lautstärkeregelung</span>
        </label>

        <h2>Kamera</h2>
        <label class="field">
          <span>Kamera</span>
          <select class="input" bind:value={settings.videoDevice} onchange={() => saveSettings()}>
            <option value="">Standard</option>
            {#each cameras.filter((d) => d.deviceId) as d (d.deviceId)}
              <option value={d.deviceId}>{d.label || 'Kamera'}</option>
            {/each}
          </select>
        </label>
      {:else if current === 'notify'}
        <h1>Benachrichtigungen</h1>
        <label class="check">
          <input type="checkbox" bind:checked={settings.notifications} onchange={() => saveSettings()} />
          <span>Desktop-Benachrichtigungen für neue Nachrichten</span>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={settings.sounds} onchange={() => saveSettings()} />
          <span>Töne (Nachrichten, Beitreten/Verlassen, Stummschalten)</span>
        </label>
      {:else if current === 'network'}
        <h1>Netzwerk</h1>
        <p class="hint">Nachrichten, Dateien und die Anruf-Aushandlung laufen komplett P2P über Hyperswarm (DHT + Holepunching). Für Anrufe fragt WebRTC zusätzlich einen STUN-Server nach der eigenen öffentlichen Adresse – das ist eine reine Adressabfrage, es fließen keine Inhalte darüber.</p>
        <label class="field">
          <span>STUN-Server (einer pro Zeile, leer = nur lokales Netz)</span>
          <textarea class="input area" rows="3" bind:value={stunText} onchange={saveStun}></textarea>
        </label>
        <div class="card">
          <div class="label">Eigener TURN-Server (optional)</div>
          <p class="hint">Nur nötig, wenn Anrufe zwischen zwei sehr restriktiven Netzwerken nicht zustande kommen. Du kannst z. B. coturn auf einem Raspberry Pi betreiben – der Server sieht nur verschlüsselte Daten.</p>
          <label class="field"><span>URL</span><input class="input" bind:value={settings.turnUrl} placeholder="turn:mein-server.de:3478" onchange={() => saveSettings()} /></label>
          <div class="grid2">
            <label class="field"><span>Benutzer</span><input class="input" bind:value={settings.turnUser} onchange={() => saveSettings()} /></label>
            <label class="field"><span>Passwort</span><input class="input" type="password" bind:value={settings.turnPass} onchange={() => saveSettings()} /></label>
          </div>
        </div>
        <p class="hint">Änderungen gelten für den nächsten Anruf.</p>
      {/if}
    </div>
  </main>

  <div class="close-col">
    <button class="close" onclick={onclose} title="Schließen (Esc)"><Icon name="x" size={20} /></button>
    <span>ESC</span>
  </div>
</div>

<style>
  .settings {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: flex;
    background: var(--bg-main);
    animation: fade 0.15s ease-out;
  }
  nav {
    flex: 1 0 218px;
    background: var(--bg-sidebar);
    display: flex;
    justify-content: flex-end;
    overflow-y: auto;
  }
  .nav-inner {
    width: 218px;
    padding: 60px 6px 20px 20px;
    display: flex;
    flex-direction: column;
  }
  .group {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    padding: 12px 10px 6px;
  }
  nav button {
    text-align: left;
    padding: 6px 10px;
    margin-bottom: 2px;
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 15px;
  }
  nav button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  nav button.active {
    background: var(--bg-active);
    color: var(--text-strong);
  }
  .sep {
    height: 1px;
    background: var(--border-soft);
    margin: 8px 10px;
  }
  .version {
    font-size: 12px;
    color: var(--text-faint);
    padding: 4px 10px;
  }
  main {
    flex: 1 1 800px;
    overflow-y: auto;
  }
  .page {
    max-width: 740px;
    padding: 60px 40px 80px;
  }
  h1 {
    font-size: 20px;
    color: var(--text-strong);
    margin: 0 0 20px;
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
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .profile {
    display: flex;
    gap: 20px;
    align-items: flex-start;
    background: var(--bg-rail);
    padding: 20px;
    border-radius: 8px;
    margin-bottom: 16px;
  }
  .profile-fields {
    flex: 1;
  }
  .card {
    background: var(--bg-sidebar);
    padding: 16px;
    border-radius: 8px;
    margin-bottom: 12px;
  }
  .card .code {
    margin: 8px 0;
  }
  .mono {
    font-family: var(--mono);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .item {
    display: flex;
    gap: 14px;
    align-items: flex-start;
  }
  .item :global(svg) {
    color: var(--green);
    flex: none;
    margin-top: 2px;
  }
  .item.warn :global(svg) {
    color: var(--yellow);
  }
  .item strong {
    color: var(--text-strong);
  }
  .item p {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 14px;
  }
  .test {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .meter {
    position: relative;
    flex: 1;
    height: 10px;
    border-radius: 5px;
    background: var(--bg-rail);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--yellow);
    transition: width 0.05s linear;
  }
  .fill.open {
    background: var(--green);
  }
  .threshold {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #fff;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
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
    font-weight: 600;
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
  .option.active :global(svg) {
    color: #a5acff;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 10px 0;
    cursor: pointer;
  }
  .check input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .area {
    height: auto;
    padding: 10px;
    font-family: var(--mono);
    font-size: 13px;
    resize: vertical;
  }
  .warn-text {
    color: var(--yellow);
  }
  .close-col {
    flex: 0 0 90px;
    padding-top: 60px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
  }
  .close {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 2px solid var(--text-muted);
    display: grid;
    place-items: center;
    color: var(--text-muted);
  }
  .close:hover {
    background: var(--bg-hover);
  }
  @keyframes fade {
    from {
      opacity: 0;
      transform: scale(1.02);
    }
  }
</style>
