<script lang="ts">
  import Icon from './Icon.svelte'
  import { ui, memberName } from '../lib/state.svelte'
  import { settings, saveSettings } from '../lib/settings.svelte'
  import { voice, setStreamQuality, setStreamVolume, toggleStreamMute, watchStream, VIEW_QUALITIES, QUALITY_ORDER, type ViewQuality } from '../lib/voice/call.svelte'

  let { identity, win }: { identity: string; win: Window } = $props()

  let stream = $derived(voice.remote[identity]?.screen || null)
  let space = $derived(ui.spaces[ui.peers[identity]?.voice?.space || ''])
  let name = $derived(memberName(space, identity))
  let quality = $derived(voice.quality[identity] || settings.viewerQuality)
  let idle = $state(false)
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  // The stream ended, we left the call or stopped watching: the window has nothing left to show
  $effect(() => {
    if (!voice.active || !voice.watching[identity] || !ui.peers[identity]?.voice?.screen) win.close()
  })

  function video (node: HTMLVideoElement, s: MediaStream | null) {
    node.srcObject = s
    return {
      update (next: MediaStream | null) {
        if (node.srcObject !== next) node.srcObject = next
      },
      destroy () {
        node.srcObject = null
      }
    }
  }

  function wake () {
    idle = false
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => (idle = true), 2500)
  }

  function fullscreen () {
    if (win.document.fullscreenElement) win.document.exitFullscreen()
    else win.document.documentElement.requestFullscreen()
  }
</script>

<div class="pop" class:idle role="presentation" onmousemove={wake} ondblclick={fullscreen}>
  {#if stream}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video use:video={stream} autoplay playsinline muted></video>
  {:else}
    <div class="wait"><span class="spinner"></span> Warte auf den Stream…</div>
  {/if}
  <div class="bar">
    <span class="live">LIVE</span>
    <span class="name">{name}</span>
    <span class="spacer"></span>
    <button class="b" title={settings.streamMutes[identity] ? 'Ton an' : 'Stumm'} onclick={() => toggleStreamMute(identity)}>
      <Icon name={settings.streamMutes[identity] ? 'volume-x' : 'volume'} size={18} />
    </button>
    <input
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={settings.streamVolumes[identity] ?? 1}
      oninput={(e) => setStreamVolume(identity, +(e.target as HTMLInputElement).value)}
      onchange={saveSettings}
      title="Stream-Lautstärke"
    />
    <select class="q" value={quality} onchange={(e) => setStreamQuality(identity, (e.target as HTMLSelectElement).value as ViewQuality)} title="Qualität für mich">
      {#each QUALITY_ORDER as q (q)}
        <option value={q}>{VIEW_QUALITIES[q].label}</option>
      {/each}
    </select>
    <button class="b" title="Vollbild" onclick={fullscreen}><Icon name="maximize" size={18} /></button>
    <button class="b" title="Nicht mehr zuschauen" onclick={() => watchStream(identity, false)}><Icon name="eye-off" size={18} /></button>
  </div>
</div>

<style>
  .pop {
    position: fixed;
    inset: 0;
    background: #000;
    color: #fff;
    font-family: var(--font);
    user-select: none;
  }
  .pop.idle {
    cursor: none;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
  .wait {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    grid-auto-flow: column;
    gap: 10px;
    align-items: center;
    color: #aaa;
  }
  .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 24px 12px 10px;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.75));
    transition: opacity 0.2s;
  }
  .idle .bar {
    opacity: 0;
  }
  .live {
    background: var(--red);
    font-size: 11px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 8px;
  }
  .name {
    font-weight: 600;
  }
  .spacer {
    flex: 1;
  }
  .b {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: #fff;
  }
  .b:hover {
    background: rgba(255, 255, 255, 0.15);
  }
  input[type='range'] {
    width: 110px;
  }
  .q {
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 4px;
    padding: 4px 6px;
  }
</style>
