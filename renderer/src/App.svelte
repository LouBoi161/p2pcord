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

  let updateReady = $state(false)

  setSoundPlayer(playSound)
  initVoice()
  boot()
  bridge.onUpdateReady(() => (updateReady = true))

  async function applyUpdate () {
    await bridge.applyUpdate()
    await bridge.relaunch()
  }
</script>

<div class="app">
  {#if ui.status === 'loading'}
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
  {:else}
    <Rail />
    <Sidebar />
    {#if voice.active}
      <CallView />
    {/if}
    <Chat compact={!!voice.active} />
  {/if}
</div>

<Dialogs />

{#if updateReady}
  <div class="update">
    Ein Update ist bereit.
    <button class="btn small" onclick={applyUpdate}>Neu starten</button>
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
    height: 100vh;
    width: 100vw;
    overflow: hidden;
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
</style>
