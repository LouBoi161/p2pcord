<script lang="ts">
  import Icon from './Icon.svelte'
  import Avatar from './Avatar.svelte'
  import { ui, memberName, spaceTitle, KIND_DM } from '../lib/state.svelte'
  import { settings, saveSettings } from '../lib/settings.svelte'
  import {
    voice,
    participants,
    peerVoice,
    leaveVoice,
    toggleMute,
    toggleDeaf,
    startCamera,
    stopCamera,
    stopScreen,
    startScreen,
    setVolume
  } from '../lib/voice/call.svelte'

  let space = $derived(voice.active ? ui.spaces[voice.active.space] : undefined)
  let channel = $derived(space?.channels.find((c) => c.id === voice.active?.channel))
  let people = $derived(voice.active ? participants(voice.active.space, voice.active.channel) : [])

  interface Tile {
    key: string
    id: string
    type: 'user' | 'screen'
    stream: MediaStream | null
  }

  let tiles: Tile[] = $derived.by(() => {
    const out: Tile[] = []
    for (const id of people) {
      const cam = id === ui.me ? voice.camera : voice.remote[id]?.cam || null
      out.push({ key: id + ':user', id, type: 'user', stream: cam })
    }
    for (const id of people) {
      const screen = id === ui.me ? voice.screen : voice.remote[id]?.screen || null
      if (screen) out.push({ key: id + ':screen', id, type: 'screen', stream: screen })
    }
    return out
  })

  let focused = $derived(tiles.find((t) => t.key === voice.focus) || null)
  let others = $derived(focused ? tiles.filter((t) => t !== focused) : tiles)
  let volumeFor = $state<string | null>(null)

  function srcObject (node: HTMLVideoElement, stream: MediaStream | null) {
    node.srcObject = stream
    return {
      update (s: MediaStream | null) {
        if (node.srcObject !== s) node.srcObject = s
      },
      destroy () {
        node.srcObject = null
      }
    }
  }

  function toggleFocus (key: string) {
    voice.focus = voice.focus === key ? null : key
  }

  function fullscreen (e: MouseEvent) {
    const tile = (e.currentTarget as HTMLElement).closest('.tile') as HTMLElement | null
    tile?.requestFullscreen?.()
  }

  function pickScreen () {
    if (voice.screen) stopScreen()
    else if (window.p2p.info().wayland) startScreen(null) // the system portal shows its own picker
    else ui.dialog = { type: 'screen' }
  }

  function connState (id: string) {
    if (id === ui.me) return 'connected'
    return voice.remote[id]?.state || 'new'
  }
</script>

<section class="call">
  <header>
    <Icon name="volume" size={20} />
    <span class="title">{channel?.name || 'Anruf'}</span>
    {#if space}<span class="sub">{space.kind === KIND_DM ? spaceTitle(space) : space.name}</span>{/if}
    <span class="spacer"></span>
    <span class="badge" title="Audio und Video gehen direkt und DTLS-SRTP-verschlüsselt an die anderen Teilnehmer. Die Schlüssel werden über die authentifizierte P2P-Verbindung ausgetauscht."><Icon name="lock" size={12} stroke={2.5} /> Ende-zu-Ende</span>
    {#if voice.noiseActive !== 'off'}
      <span class="badge ai" title="Hintergrundgeräusche werden lokal auf deinem Gerät entfernt"><Icon name="sparkles" size={12} stroke={2.5} /> {voice.noiseActive === 'dfn3' ? 'KI-Rauschfilter' : 'RNNoise'}</span>
    {/if}
  </header>

  <div class="stage" class:focused={!!focused}>
    {#if focused}
      {@render tileView(focused, true)}
    {/if}
    <div class="grid" class:strip={!!focused} class:one={others.length === 1} class:two={others.length === 2}>
      {#each others as tile (tile.key)}
        {@render tileView(tile, false)}
      {/each}
    </div>
  </div>

  <footer>
    <button class="ctl" class:off={voice.muted} title={voice.muted ? 'Stummschaltung aufheben' : 'Stummschalten'} onclick={toggleMute}>
      <Icon name={voice.muted ? 'mic-off' : 'mic'} size={22} />
    </button>
    <button class="ctl" class:off={voice.deaf} title={voice.deaf ? 'Ton an' : 'Ton aus'} onclick={toggleDeaf}>
      <Icon name={voice.deaf ? 'headphones-off' : 'headphones'} size={22} />
    </button>
    <button class="ctl" class:on={!!voice.camera} title={voice.camera ? 'Kamera aus' : 'Kamera an'} onclick={() => (voice.camera ? stopCamera() : startCamera())}>
      <Icon name={voice.camera ? 'video' : 'video-off'} size={22} />
    </button>
    <button class="ctl" class:on={!!voice.screen} title={voice.screen ? 'Übertragung beenden' : 'Bildschirm teilen'} onclick={pickScreen}>
      <Icon name={voice.screen ? 'monitor-off' : 'monitor-up'} size={22} />
    </button>
    <button class="ctl" title="Audio-Einstellungen" onclick={() => (ui.dialog = { type: 'settings', tab: 'voice' })}>
      <Icon name="settings" size={22} />
    </button>
    <button class="ctl leave" title="Auflegen" onclick={() => leaveVoice()}>
      <Icon name="phone-off" size={22} />
    </button>
  </footer>
</section>

{#snippet tileView(tile: Tile, big: boolean)}
  {@const v = peerVoice(tile.id)}
  {@const name = memberName(space, tile.id)}
  <div
    class="tile"
    class:big
    class:screen={tile.type === 'screen'}
    class:speaking={tile.type === 'user' && !!voice.speaking[tile.id]}
    role="button"
    tabindex="0"
    ondblclick={fullscreen}
    onclick={() => toggleFocus(tile.key)}
    onkeydown={(e) => e.key === 'Enter' && toggleFocus(tile.key)}
  >
    {#if tile.stream}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video use:srcObject={tile.stream} autoplay playsinline muted class:mirror={tile.id === ui.me && tile.type === 'user'}></video>
    {:else}
      <div class="avatar-wrap">
        <Avatar id={tile.id} {name} size={big ? 96 : 72} speaking={!!voice.speaking[tile.id]} />
      </div>
    {/if}
    <div class="name-tag">
      {#if tile.type === 'screen'}<Icon name="monitor" size={14} />{/if}
      <span>{tile.type === 'screen' ? `${name}s Bildschirm` : name}</span>
      {#if tile.type === 'user'}
        {#if v?.deaf}<Icon name="headphones-off" size={14} />{:else if v?.muted}<Icon name="mic-off" size={14} />{/if}
      {/if}
    </div>
    {#if tile.id !== ui.me && connState(tile.id) !== 'connected' && tile.type === 'user'}
      <div class="conn">{connState(tile.id) === 'failed' ? 'Verbindung fehlgeschlagen – versuche erneut…' : 'Verbinde…'}</div>
    {/if}
    {#if tile.id !== ui.me && tile.type === 'user'}
      <div class="tile-tools">
        <button class="tool" title="Lautstärke" onclick={(e) => { e.stopPropagation(); volumeFor = volumeFor === tile.id ? null : tile.id }}>
          <Icon name="volume" size={16} />
        </button>
      </div>
      {#if volumeFor === tile.id}
        <div class="volume" role="presentation" onclick={(e) => e.stopPropagation()}>
          <span>{Math.round((settings.volumes[tile.id] ?? 1) * 100)}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings.volumes[tile.id] ?? 1}
            oninput={(e) => setVolume(tile.id, +(e.target as HTMLInputElement).value)}
            onchange={saveSettings}
          />
        </div>
      {/if}
    {/if}
  </div>
{/snippet}

<style>
  .call {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-call);
  }
  header {
    height: 48px;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px;
    color: var(--text-muted);
  }
  .title {
    color: var(--text-strong);
    font-weight: 600;
  }
  .sub {
    font-size: 13px;
  }
  .spacer {
    flex: 1;
  }
  .badge.ai {
    background: rgba(88, 101, 242, 0.18);
    color: #a5acff;
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 16px;
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fit, minmax(max(220px, calc((100% - 16px) / 3)), 1fr));
    align-content: center;
    overflow-y: auto;
  }
  .grid:not(.strip) .tile {
    aspect-ratio: 16 / 9;
  }
  .grid.one {
    grid-template-columns: 1fr;
    max-width: 960px;
    width: 100%;
    margin: 0 auto;
  }
  .grid.two {
    grid-template-columns: 1fr 1fr;
  }
  .grid.strip {
    flex: none;
    height: 130px;
    display: flex;
    overflow-x: auto;
    justify-content: center;
  }
  .grid.strip .tile {
    width: 220px;
    flex: none;
  }
  .tile {
    position: relative;
    background: var(--bg-tile);
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    min-height: 0;
    outline: 2px solid transparent;
    transition: outline-color 0.1s;
  }
  .tile.big {
    flex: 1;
    min-height: 0;
  }
  .tile.speaking {
    outline-color: var(--green);
  }
  .tile video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
    display: block;
  }
  .tile:not(.screen) video {
    object-fit: cover;
  }
  video.mirror {
    transform: scaleX(-1);
  }
  .avatar-wrap {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .avatar-wrap :global(.avatar.speaking) {
    box-shadow:
      0 0 0 3px var(--bg-tile),
      0 0 0 6px var(--green);
  }
  .name-tag {
    position: absolute;
    left: 8px;
    bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 16px);
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 13px;
    font-weight: 500;
  }
  .name-tag span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .conn {
    position: absolute;
    top: 8px;
    left: 8px;
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(240, 178, 50, 0.2);
    color: var(--yellow);
  }
  .tile-tools {
    position: absolute;
    top: 8px;
    right: 8px;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .tile:hover .tile-tools {
    opacity: 1;
  }
  .tool {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
  }
  .volume {
    position: absolute;
    top: 44px;
    right: 8px;
    width: 180px;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--bg-float);
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: var(--text-muted);
    cursor: default;
  }
  footer {
    display: flex;
    justify-content: center;
    gap: 12px;
    padding: 12px 16px 20px;
  }
  .ctl {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: #2b2d31;
    color: var(--text);
    transition: background 0.12s;
  }
  .ctl:hover {
    background: #3b3d44;
  }
  .ctl.off {
    background: #fff;
    color: var(--red);
  }
  .ctl.on {
    background: var(--green);
    color: #fff;
  }
  .ctl.leave {
    background: var(--red);
    color: #fff;
    width: 64px;
    border-radius: 26px;
  }
  .ctl.leave:hover {
    background: var(--red-hover);
  }
</style>
