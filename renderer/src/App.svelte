<script lang="ts">
  import Rail from './components/Rail.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import CallView from './components/CallView.svelte'
  import Chat from './components/Chat.svelte'
  import Dialogs from './components/Dialogs.svelte'
  import Onboarding from './components/Onboarding.svelte'
  import Icon from './components/Icon.svelte'
  import Logo from './components/Logo.svelte'
  import { ui, boot, setSoundPlayer } from './lib/state.svelte'
  import Avatar from './components/Avatar.svelte'
  import { voice, initVoice, acceptCall, declineCall } from './lib/voice/call.svelte'
  import { memberName } from './lib/state.svelte'
  import { playSound } from './lib/voice/audio'
  import { bridge } from './lib/rpc'
  import { update } from './lib/update.svelte'
  import ContextMenu from './components/ContextMenu.svelte'
  import TsNav from './components/TsNav.svelte'
  import DesignWelcome from './components/DesignWelcome.svelte'
  import { settings, saveSettings } from './lib/settings.svelte'
  import WebSetup from './components/WebSetup.svelte'
  import { web } from './lib/bridges/web.svelte'
  import { startBridgeHost } from './lib/bridge-host.svelte'
  import { leaveVoice } from './lib/voice/call.svelte'

  const info = bridge.info()
  const mobile = info.mobile

  setSoundPlayer(playSound)
  initVoice()
  boot().then(() => {
    // desktop only: friends with an iPhone can use this app as their bridge
    if (!info.bridged && !mobile && ui.status === 'ready') startBridgeHost()
  })

  // Phones: joining a call shows it; the Android back button walks back
  let wasInCall = false
  $effect(() => {
    const active = !!voice.active
    if (active && !wasInCall) ui.pane = 'call'
    if (!active && ui.pane === 'call') ui.pane = ui.chat ? 'chat' : 'nav'
    wasInCall = active
    bridge.setCallActive(active)
  })
  $effect(() => {
    if (!mobile) return
    return bridge.onBack(() => {
      if (ui.dialog) {
        ui.dialog = null
        return true
      }
      if (ui.pane !== 'nav') {
        ui.pane = 'nav'
        return true
      }
      return false
    })
  })

  const u = $derived(update.state)
  // Portrait, 4:3 or simply small windows: call on top, chat below instead of side by side
  let winW = $state(window.innerWidth)
  let winH = $state(window.innerHeight)
  const ts = $derived(settings.layout === 'teamspeak')
  const stacked = $derived(ts || winW < 1180 || winW < winH * 1.25)
  const narrow = $derived(winW < 820)

  // Ctrl +/-/0 zoom (there is no app menu providing these)
  function onKey (e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey) return
    let v = settings.uiScale
    if (e.key === '+' || e.key === '=') v = Math.min(1.5, v + 0.1)
    else if (e.key === '-') v = Math.max(0.75, v - 0.1)
    else if (e.key === '0') v = 1
    else return
    e.preventDefault()
    settings.uiScale = Math.round(v * 100) / 100
    saveSettings()
    bridge.setZoom(settings.uiScale)
  }

  const showUpdate = $derived(!update.dismissed && (u.status === 'ready' || u.status === 'downloading' || u.status === 'available' || (u.status === 'error' && !u.quiet)))
</script>

<div class="app" class:mobile>
  {#if info.bridged && web.status !== 'ready'}
    <WebSetup />
  {:else if ui.status === 'loading'}
    <div class="splash">
      <Logo size={80} />
      <span class="spinner"></span>
      <p>Verbinde mit dem P2P-Netz…</p>
    </div>
  {:else if ui.status === 'fatal'}
    <div class="splash">
      <div class="logo error"><Icon name="x" size={40} /></div>
      <h2>Etwas ist schiefgelaufen</h2>
      <p class="selectable">{ui.error}</p>
      <button class="btn" onclick={() => location.reload()}>Neu laden</button>
    </div>
  {:else if !ui.name}
    <Onboarding />
  {:else if mobile}
    <!-- phones: one screen at a time -->
    {#if voice.active && ui.pane !== 'call'}
      <button class="call-bar" onclick={() => (ui.pane = 'call')}>
        <Icon name="volume" size={16} />
        <span>{voice.joining ? 'Verbinde…' : 'Im Sprachkanal – tippen zum Zurückkehren'}</span>
        <span class="hangup" role="button" tabindex="0" title="Auflegen" onclick={(e) => { e.stopPropagation(); leaveVoice() }} onkeydown={() => {}}><Icon name="phone-off" size={16} /></span>
      </button>
    {/if}
    <div class="row">
      {#if ui.pane === 'call' && voice.active}
        <div class="main in-call stacked"><CallView onback={() => (ui.pane = 'nav')} onchat={() => (ui.pane = 'chat')} /></div>
      {:else if ui.pane === 'chat' && ui.chat}
        <div class="main"><Chat onback={() => (ui.pane = 'nav')} /></div>
      {:else}
        <Rail />
        <Sidebar />
      {/if}
    </div>
  {:else}
    <div class="row">
      {#if ts}
        <TsNav />
      {:else}
        <Rail />
      {/if}
      <!-- TeamSpeak: direct messages live in the navigator, the channel column is only for groups -->
      {#if !settings.sidebarHidden && !(narrow && voice.active) && !(ts && ui.view === 'home')}
        <Sidebar />
      {/if}
      <div class="main" class:stacked class:in-call={!!voice.active}>
        {#if voice.active}
          <CallView />
        {/if}
        {#if !voice.active || settings.callChat}
          <Chat compact={!!voice.active} {stacked} />
        {/if}
      </div>
    </div>
    {#if !settings.designChosen}<DesignWelcome />{/if}
  {/if}
</div>

<svelte:window bind:innerWidth={winW} bind:innerHeight={winH} onkeydown={onKey} />
<ContextMenu />

<Dialogs />

{#if showUpdate}
  <div class="update" class:error={u.status === 'error'} role="status">
    {#if u.status === 'ready'}
      <span>P2Pcord {u.latest} ist installiert.</span>
      <button class="btn small" onclick={() => bridge.relaunch()}>Neu starten</button>
    {:else if u.status === 'downloading'}
      <span>Update auf {u.latest} wird geladen… {Math.round((u.progress ?? 0) * 100)} %</span>
    {:else if u.status === 'available' && u.mode === 'package'}
      <span>P2Pcord {u.latest} ist da – aktualisiere über deinen Paketmanager (z. B. <code>paru</code>).</span>
    {:else if u.status === 'available'}
      <span>P2Pcord {u.latest} ist verfügbar.</span>
      <button class="btn small" onclick={() => bridge.openExternal(u.url!)}>Herunterladen</button>
    {:else}
      <span>Update fehlgeschlagen: {u.error}</span>
    {/if}
    <button class="close" title="Schließen" aria-label="Schließen" onclick={() => (update.dismissed = true)}><Icon name="x" size={16} /></button>
  </div>
{/if}

{#if voice.incoming}
  {@const c = voice.incoming}
  <div class="incoming" role="alertdialog" aria-label="Eingehender Anruf">
    <Avatar id={c.from} name={memberName(ui.spaces[c.space], c.from)} size={56} speaking />
    <div class="incoming-text">
      <strong>{memberName(ui.spaces[c.space], c.from)}</strong>
      <span>ruft dich an…</span>
    </div>
    <button class="round decline" title="Ablehnen" onclick={declineCall}><Icon name="phone-off" size={22} /></button>
    <button class="round accept" title="Annehmen" onclick={acceptCall}><Icon name="phone" size={22} /></button>
  </div>
{/if}

<div class="toasts">
  {#each ui.toasts as t (t.id)}
    <div class="toast" class:error={t.kind === 'error'}>{t.text}</div>
  {/each}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    width: 100vw;
    overflow: hidden;
  }
  /* phones: notch and home indicator (iOS), system bars are handled natively on Android */
  .app.mobile {
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
    background: var(--bg-rail);
  }
  .app.mobile :global(.sidebar) {
    flex: 1;
    width: auto;
    min-width: 0;
  }
  .app.mobile :global(.chat) {
    min-width: 0;
  }
  .call-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--green);
    color: #fff;
    font-weight: 600;
    font-size: 14px;
    text-align: left;
  }
  .call-bar span:not(.hangup) {
    flex: 1;
  }
  .hangup {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--red);
  }
  .row {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
  }
  .main.stacked.in-call {
    flex-direction: column;
  }
  .splash {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    color: var(--text-muted);
  }
  .splash h2 {
    color: var(--text-strong);
    margin: 0;
  }
  .splash p {
    max-width: 480px;
    text-align: center;
    margin: 0;
  }
  .logo {
    width: 80px;
    height: 80px;
    border-radius: 24px;
    background: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
  }
  .logo.error {
    background: var(--red);
  }
  .toasts {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 200;
    pointer-events: none;
  }
  .toast {
    background: var(--bg-float);
    color: var(--text);
    padding: 10px 16px;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    font-size: 14px;
    max-width: 520px;
    animation: up 0.18s ease-out;
    border-left: 4px solid var(--green);
  }
  .toast.error {
    border-left-color: var(--red);
  }
  .update {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--green);
    color: #fff;
    padding: 6px 8px 6px 16px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 12px;
    z-index: 150;
    font-weight: 500;
    max-width: calc(100vw - 32px);
  }
  .update.error {
    background: var(--red);
  }
  .update code {
    font-family: var(--mono);
  }
  .update .close {
    display: grid;
    place-items: center;
    padding: 2px;
    border-radius: 4px;
    color: inherit;
    opacity: 0.8;
  }
  .update .close:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.15);
  }
  .incoming {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 160;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    border-radius: 10px;
    background: var(--bg-float);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    animation: up 0.2s ease-out;
    min-width: 320px;
  }
  .incoming-text {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .incoming-text strong {
    color: var(--text-strong);
  }
  .incoming-text span {
    color: var(--text-muted);
    font-size: 13px;
  }
  .round {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: #fff;
  }
  .round.accept {
    background: var(--green);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .round.decline {
    background: var(--red);
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 8px rgba(35, 165, 90, 0.25);
    }
  }
  @keyframes up {
    from {
      transform: translateY(8px);
      opacity: 0;
    }
  }
  :global([data-mobile]) .incoming {
    left: 12px;
    right: 12px;
    top: calc(env(safe-area-inset-top) + 8px);
    min-width: 0;
  }
  :global([data-mobile]) .toasts {
    bottom: calc(env(safe-area-inset-bottom) + 72px);
    width: calc(100vw - 32px);
    align-items: center;
  }
</style>
