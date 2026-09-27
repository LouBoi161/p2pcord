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
    isStreaming,
    watchStream,
    setStreamVolume,
    toggleStreamAudio,
    toggleStreamMute
  } from '../lib/voice/call.svelte'
  import { userMenu, streamMenu, fullscreenTile } from '../lib/menus'
  import { popped, popOut, closePopout } from '../lib/popout.svelte'
  import { bestGrid } from '../lib/layout'

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
    // streams first: they are what people look at
    for (const id of people) {
      if (!isStreaming(id)) continue
      const screen = id === ui.me ? voice.screen : voice.remote[id]?.screen || null
      out.push({ key: id + ':screen', id, type: 'screen', stream: screen })
    }
    for (const id of people) {
      const cam = id === ui.me ? voice.camera : voice.remote[id]?.cam || null
      out.push({ key: id + ':user', id, type: 'user', stream: cam })
    }
    return out
  })

  let focused = $derived(tiles.find((t) => t.key === voice.focus) || null)
  let others = $derived(focused ? tiles.filter((t) => t !== focused) : tiles)
  let viewers = $derived(Object.keys(voice.viewers).length)

  // grid geometry: as many columns as make the tiles largest for this window shape
  let gridW = $state(0)
  let gridH = $state(0)
  let grid = $derived(bestGrid(others.length, gridW, gridH, 16 / 9, 8))

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

  function toggleFocus (tile: Tile) {
    if (tile.type === 'screen' && tile.id !== ui.me && !voice.watching[tile.id]) {
      watchStream(tile.id, true)
      voice.focus = tile.key
      return
    }
    voice.focus = voice.focus === tile.key ? null : tile.key
  }

  function pickScreen () {
    if (voice.screen) stopScreen()
    else ui.dialog = { type: 'screen' }
  }

  function connState (id: string) {
    if (id === ui.me) return 'connected'
    return voice.remote[id]?.state || 'new'
  }

  function onContext (e: MouseEvent, tile: Tile) {
    if (tile.type === 'screen') streamMenu(e, tile.id)
    else userMenu(e, tile.id, voice.active?.space)
  }

  function stop (e: Event) {
    e.stopPropagation()
  }
</script>

<section class="call">
  <header>
    <Icon name="volume" size={20} />
    <span class="title">{channel?.name || 'Anruf'}</span>
    {#if space}<span class="sub">{space.kind === KIND_DM ? spaceTitle(space) : space.name}</span>{/if}
    <span class="spacer"></span>
    <span class="badge" title="Audio und Video gehen direkt und DTLS-SRTP-verschlüsselt an die anderen Teilnehmer. Die Schlüssel werden über die authentifizierte P2P-Verbindung ausgetauscht."><Icon name="lock" size={12} stroke={2.5} /> <span class="badge-text">Ende-zu-Ende</span></span>
    {#if voice.noiseActive !== 'off'}
      <span class="badge ai" title="Hintergrundgeräusche werden lokal auf deinem Gerät entfernt"><Icon name="sparkles" size={12} stroke={2.5} /> <span class="badge-text">{voice.noiseActive === 'dfn3' ? 'KI-Rauschfilter' : 'RNNoise'}</span></span>
    {/if}
    <button class="icon-btn" class:on={settings.callChat} title={settings.callChat ? 'Chat ausblenden' : 'Chat einblenden'} onclick={() => { settings.callChat = !settings.callChat; saveSettings() }}>
      <Icon name="chat" size={18} />
    </button>
  </header>

  <div class="stage" class:focused={!!focused}>
    {#if focused}
      <div class="focus-area">
        {@render tileView(focused, true)}
      </div>
    {/if}
    <div class="grid" class:strip={!!focused} bind:clientWidth={gridW} bind:clientHeight={gridH}
      style={focused ? '' : `grid-template-columns: repeat(${grid.cols}, ${grid.w}px); grid-auto-rows: ${grid.h}px;`}>
      {#each others as tile (tile.key)}
        {@render tileView(tile, false)}
      {/each}
    </div>
  </div>

  <footer class="controls">
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
    {#if voice.screen && voice.screenHasAudio}
      <button class="ctl" class:off={!voice.screenAudioOn} title={voice.screenAudioOn ? 'Stream-Ton pausieren' : 'Stream-Ton fortsetzen'} onclick={toggleStreamAudio}>
        <Icon name={voice.screenAudioOn ? 'volume' : 'volume-x'} size={22} />
      </button>
    {/if}
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
  {@const own = tile.id === ui.me}
  {@const screen = tile.type === 'screen'}
  {@const watching = own || !!voice.watching[tile.id]}
  {@const out = screen && !own && !!popped[tile.id]}
  <div
    class="tile"
    class:big
    class:screen
    class:speaking={!screen && !!voice.speaking[tile.id]}
    data-tile={tile.key}
    role="button"
    tabindex="0"
    ondblclick={() => fullscreenTile(tile.key)}
    onclick={() => toggleFocus(tile)}
    oncontextmenu={(e) => onContext(e, tile)}
    onkeydown={(e) => e.key === 'Enter' && toggleFocus(tile)}
  >
    {#if screen && !watching}
      <div class="invite">
        <Avatar id={tile.id} {name} size={big ? 72 : 48} />
        <span class="live big-live">LIVE</span>
        <strong>{name} streamt</strong>
        <button class="btn small" onclick={(e) => { stop(e); watchStream(tile.id, true); voice.focus = tile.key }}><Icon name="eye" size={16} /> Stream ansehen</button>
      </div>
    {:else if out}
      <div class="invite">
        <Icon name="external-link" size={big ? 40 : 28} />
        <strong>Im eigenen Fenster geöffnet</strong>
        <button class="btn small secondary" onclick={(e) => { stop(e); closePopout(tile.id) }}>Zurückholen</button>
      </div>
    {:else if tile.stream}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video use:srcObject={tile.stream} autoplay playsinline muted class:mirror={own && !screen}></video>
    {:else if screen}
      <div class="invite"><span class="spinner"></span><span>Warte auf das Bild…</span></div>
    {:else}
      <div class="avatar-wrap">
        <Avatar id={tile.id} {name} size={big ? 96 : 72} speaking={!!voice.speaking[tile.id]} />
      </div>
    {/if}
    <div class="name-tag">
      {#if screen}<span class="live">LIVE</span>{/if}
      <span>{screen ? (own ? 'Dein Bildschirm' : `${name}s Bildschirm`) : name}</span>
      {#if !screen}
        {#if v?.deaf}<Icon name="headphones-off" size={14} />{:else if v?.muted}<Icon name="mic-off" size={14} />{:else if settings.localMutes[tile.id]}<Icon name="volume-x" size={14} />{/if}
      {/if}
      {#if screen && own}
        <span class="viewers" title="Zuschauer"><Icon name="eye" size={13} /> {viewers}</span>
      {/if}
    </div>
    {#if !own && connState(tile.id) !== 'connected' && !screen}
      <div class="conn">{connState(tile.id) === 'failed' ? 'Verbindung fehlgeschlagen – versuche erneut…' : 'Verbinde…'}</div>
    {/if}
    {#if screen && !own && watching}
      <div class="tile-tools" role="presentation" onclick={stop}>
        <button class="tool" title={settings.streamMutes[tile.id] ? 'Stream-Ton an' : 'Stream stummschalten'} onclick={() => toggleStreamMute(tile.id)}>
          <Icon name={settings.streamMutes[tile.id] ? 'volume-x' : 'volume'} size={16} />
        </button>
        <input class="vol" type="range" min="0" max="1" step="0.01" value={settings.streamVolumes[tile.id] ?? 1}
          oninput={(e) => setStreamVolume(tile.id, +(e.target as HTMLInputElement).value)} onchange={saveSettings} title="Stream-Lautstärke" />
        <button class="tool" title="Qualität und mehr" onclick={(e) => streamMenu(e, tile.id)}><Icon name="gauge" size={16} /></button>
        {#if !out}<button class="tool" title="In eigenem Fenster öffnen" onclick={() => popOut(tile.id)}><Icon name="external-link" size={16} /></button>{/if}
        <button class="tool" title="Vollbild" onclick={() => fullscreenTile(tile.key)}><Icon name="maximize" size={16} /></button>
        <button class="tool" title="Nicht mehr zuschauen" onclick={() => watchStream(tile.id, false)}><Icon name="eye-off" size={16} /></button>
      </div>
    {:else if !own && !screen}
      <div class="tile-tools" role="presentation" onclick={stop}>
        <button class="tool" title="Lautstärke und mehr" onclick={(e) => userMenu(e, tile.id, voice.active?.space)}><Icon name="more" size={16} /></button>
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .call {
    flex: 1;
    min-width: 0;
    min-height: 0;
    container-type: inline-size;
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
    padding: 0 12px 0 16px;
    color: var(--text-muted);
  }
  .title {
    color: var(--text-strong);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .spacer {
    flex: 1;
  }
  .badge.ai {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent-text);
  }
  @container (max-width: 520px) {
    .badge-text {
      display: none;
    }
  }
  .icon-btn.on {
    color: var(--text-strong);
  }
  .stage {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 16px;
    container-type: size;
  }
  .focus-area {
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    gap: 8px;
    justify-content: center;
    align-content: center;
    overflow: hidden;
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
  @container (max-height: 360px) {
    .grid.strip {
      height: 90px;
    }
    .grid.strip .tile {
      width: 150px;
    }
  }
  .tile {
    position: relative;
    background: var(--bg-tile);
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    min-height: 0;
    min-width: 0;
    outline: 2px solid transparent;
    transition: outline-color 0.1s;
  }
  .tile.big {
    flex: 1;
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
  .tile:not(.screen):not(.big) video {
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
  .invite {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px;
    text-align: center;
    color: var(--text-muted);
    background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 70%), var(--bg-tile);
  }
  .invite strong {
    color: var(--text-strong);
  }
  .grid:not(.strip) .tile:not(.big) .invite :global(.avatar),
  .strip .invite :global(.avatar) {
    display: none;
  }
  .strip .invite strong,
  .strip .invite .big-live {
    display: none;
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
  .live {
    background: var(--red);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 8px;
    flex: none;
  }
  .viewers {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: #ddd;
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
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.1s;
    cursor: default;
  }
  .tile:hover .tile-tools,
  .tile:focus-within .tile-tools {
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
  .tool:hover {
    background: rgba(0, 0, 0, 0.85);
  }
  .vol {
    width: 90px;
  }
  .strip .tile-tools .vol,
  .strip .tile-tools .tool:not(:last-child) {
    display: none;
  }
  :global([data-layout='teamspeak']) .controls {
    display: none;
  }
  footer {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 12px 16px 20px;
  }
  .ctl {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--bg-control);
    color: var(--text);
    transition: background 0.12s;
  }
  .ctl:hover {
    background: var(--bg-control-hover);
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
