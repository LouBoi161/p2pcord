<script lang="ts">
  import Icon from './Icon.svelte'
  import Avatar from './Avatar.svelte'
  import {
    ui,
    dms,
    openChannel,
    openDm,
    unread,
    spaceUnread,
    memberName,
    dmPartner,
    isOnline,
    cancelJoin,
    TEXT,
    VOICE,
    ROLE_ADMIN,
    type Space
  } from '../lib/state.svelte'
  import { voice, participants, peerVoice, joinVoice, leaveVoice, toggleMute, toggleDeaf } from '../lib/voice/call.svelte'

  let space = $derived(ui.view !== 'home' ? ui.spaces[ui.view] : undefined)
  let menuOpen = $state(false)
  let isAdmin = $derived(!!space && space.role >= ROLE_ADMIN)

  let activeSpace = $derived(voice.active ? ui.spaces[voice.active.space] : undefined)
  let activeChannel = $derived(activeSpace?.channels.find((c) => c.id === voice.active?.channel))

  function menu (type: string) {
    menuOpen = false
    ui.dialog = { type, space: ui.view }
  }

  function dmLabel (s: Space) {
    return dmPartner(s)?.name || 'Warte auf Freund…'
  }
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<aside class="sidebar">
  {#if space}
    <header class="head clickable" onclick={(e) => { e.stopPropagation(); menuOpen = !menuOpen }} role="button" tabindex="0" onkeydown={() => {}}>
      <span class="title">{space.name}</span>
      <Icon name={menuOpen ? 'x' : 'chevron-down'} size={18} />
    </header>
    {#if menuOpen}
      <div class="menu" role="menu" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
        <button class="accent" onclick={() => menu('invite')}>Leute einladen <Icon name="user-plus" size={16} /></button>
        <button onclick={() => menu('members')}>Mitglieder <Icon name="users" size={16} /></button>
        {#if isAdmin}
          <button onclick={() => menu('channel')}>Kanal erstellen <Icon name="plus-circle" size={16} /></button>
          <button onclick={() => menu('rename')}>Gruppe umbenennen <Icon name="edit" size={16} /></button>
        {/if}
        <div class="menu-sep"></div>
        <button class="danger" onclick={() => menu('leave')}>Gruppe verlassen <Icon name="logout" size={16} /></button>
      </div>
    {/if}

    <div class="list thin-scroll">
      <div class="section">
        <span>Textkanäle</span>
        {#if isAdmin}<button class="add" title="Kanal erstellen" onclick={() => (ui.dialog = { type: 'channel', space: space.id, kind: TEXT })}><Icon name="plus" size={16} /></button>{/if}
      </div>
      {#each space.channels.filter((c) => c.kind === TEXT) as ch (ch.id)}
        <button
          class="channel"
          class:active={ui.chat?.channel === ch.id}
          class:unread={unread(space, ch) && ui.chat?.channel !== ch.id}
          onclick={() => openChannel(space.id, ch.id)}
        >
          <Icon name="hash" size={20} />
          <span class="name">{ch.name}</span>
        </button>
      {/each}

      <div class="section">
        <span>Sprachkanäle</span>
        {#if isAdmin}<button class="add" title="Sprachkanal erstellen" onclick={() => (ui.dialog = { type: 'channel', space: space.id, kind: VOICE })}><Icon name="plus" size={16} /></button>{/if}
      </div>
      {#each space.channels.filter((c) => c.kind === VOICE) as ch (ch.id)}
        {@const inside = participants(space.id, ch.id)}
        <button
          class="channel"
          class:active={voice.active?.channel === ch.id}
          onclick={() => joinVoice(space.id, ch.id)}
          title="Beitreten"
        >
          <Icon name="volume" size={20} />
          <span class="name">{ch.name}</span>
        </button>
        {#each inside as id (id)}
          {@const v = peerVoice(id)}
          <div class="voice-user">
            <Avatar {id} name={memberName(space, id)} size={24} speaking={!!voice.speaking[id]} />
            <span class="name">{memberName(space, id)}</span>
            {#if v?.screen}<span class="live">LIVE</span>{/if}
            {#if v?.video}<Icon name="video" size={14} />{/if}
            {#if v?.deaf}<Icon name="headphones-off" size={14} />{:else if v?.muted}<Icon name="mic-off" size={14} />{/if}
          </div>
        {/each}
      {/each}
    </div>
  {:else}
    <header class="head">
      <span class="title">Direktnachrichten</span>
    </header>
    <div class="list thin-scroll">
      <button class="channel big" onclick={() => (ui.dialog = { type: 'friend' })}>
        <Icon name="user-plus" size={20} />
        <span class="name">Freund hinzufügen</span>
      </button>
      <button class="channel big" onclick={() => (ui.dialog = { type: 'create', tab: 'join' })}>
        <Icon name="ticket" size={20} />
        <span class="name">Code einlösen</span>
      </button>

      {#each ui.joining as code (code)}
        <div class="joining">
          <span class="spinner"></span>
          <span class="name">Trete bei…</span>
          <button class="icon-btn" title="Abbrechen" onclick={() => cancelJoin(code)}><Icon name="x" size={16} /></button>
        </div>
      {/each}

      <div class="section"><span>Direktnachrichten</span></div>
      {#each dms() as dm (dm.id)}
        {@const partner = dmPartner(dm)}
        <div class="dm-row">
          <button
            class="dm"
            class:active={ui.chat?.space === dm.id}
            class:unread={spaceUnread(dm) && ui.chat?.space !== dm.id}
            onclick={() => openDm(dm.id)}
          >
            <Avatar id={partner?.identity || dm.id} name={dmLabel(dm)} size={32} status={partner ? (isOnline(partner.identity) ? 'online' : 'offline') : null} />
            <span class="name">{dmLabel(dm)}</span>
            {#if voice.active?.space === dm.id}<Icon name="volume" size={14} />{/if}
          </button>
          <button class="remove" title="Freund entfernen" onclick={() => (ui.dialog = { type: 'leave', space: dm.id })}><Icon name="x" size={16} /></button>
        </div>
      {:else}
        <p class="empty">Noch keine Freunde. Klick auf „Freund hinzufügen“ und schick den Code an einen Freund.</p>
      {/each}
    </div>
  {/if}

  {#if voice.active || voice.joining}
    <div class="voice-panel">
      <div class="voice-info">
        <span class="connected" class:connecting={voice.joining}>
          <Icon name="signal" size={16} stroke={2.5} />
          {voice.joining ? 'Verbinde…' : 'Sprachverbindung'}
        </span>
        {#if activeSpace && activeChannel}
          <span class="where">{activeChannel.name} / {activeSpace.kind === 0 ? activeSpace.name : memberName(activeSpace, dmPartner(activeSpace)?.identity || '')}</span>
        {/if}
      </div>
      <button class="icon-btn" title="Auflegen" onclick={() => leaveVoice()}><Icon name="phone-off" size={20} /></button>
    </div>
  {/if}

  <div class="user-panel">
    <Avatar id={ui.me} name={ui.name} size={32} status="online" speaking={!!voice.speaking[ui.me]} />
    <div class="user-info">
      <span class="user-name">{ui.name}</span>
      <span class="user-sub">{voice.active ? (voice.noiseActive === 'dfn3' ? 'KI-Rauschfilter an' : voice.noiseActive === 'rnnoise' ? 'RNNoise an' : 'Kein Rauschfilter') : 'Online'}</span>
    </div>
    <button class="icon-btn" class:off={voice.muted} title={voice.muted ? 'Stummschaltung aufheben' : 'Stummschalten'} onclick={toggleMute}>
      <Icon name={voice.muted ? 'mic-off' : 'mic'} size={20} />
    </button>
    <button class="icon-btn" class:off={voice.deaf} title={voice.deaf ? 'Ton an' : 'Ton aus'} onclick={toggleDeaf}>
      <Icon name={voice.deaf ? 'headphones-off' : 'headphones'} size={20} />
    </button>
    <button class="icon-btn" title="Einstellungen" onclick={() => (ui.dialog = { type: 'settings' })}>
      <Icon name="settings" size={20} />
    </button>
  </div>
</aside>

<style>
  .sidebar {
    width: 240px;
    min-width: 240px;
    background: var(--bg-sidebar);
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .head {
    height: 48px;
    min-height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
    box-shadow: 0 1px 0 rgba(4, 4, 5, 0.2);
    font-weight: 600;
    color: var(--text-strong);
  }
  .head.clickable {
    cursor: pointer;
  }
  .head.clickable:hover {
    background: var(--bg-hover);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu {
    position: absolute;
    top: 54px;
    left: 10px;
    right: 10px;
    background: var(--bg-float);
    border-radius: 6px;
    padding: 6px 8px;
    z-index: 20;
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.24);
    display: flex;
    flex-direction: column;
  }
  .menu button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 7px 8px;
    border-radius: 3px;
    font-size: 14px;
    color: var(--text);
  }
  .menu button:hover {
    background: var(--accent);
    color: #fff;
  }
  .menu .accent {
    color: #949cf7;
  }
  .menu .danger {
    color: #f23f42;
  }
  .menu .danger:hover {
    background: var(--red);
  }
  .menu-sep {
    height: 1px;
    background: var(--border-soft);
    margin: 4px;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 8px 12px;
  }
  .section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 8px 4px 8px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--text-muted);
  }
  .section .add {
    color: var(--text-muted);
  }
  .section .add:hover {
    color: var(--text);
  }
  .channel,
  .dm {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    margin: 1px 0;
    border-radius: 4px;
    color: var(--text-muted);
    text-align: left;
  }
  .channel :global(svg) {
    flex: none;
    color: var(--text-faint);
  }
  .channel:hover,
  .dm:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .channel.active,
  .dm.active {
    background: var(--bg-active);
    color: var(--text-strong);
  }
  .channel.unread,
  .dm.unread {
    color: var(--text-strong);
    font-weight: 600;
  }
  .channel.unread::before,
  .dm.unread::before {
    content: '';
    position: absolute;
    left: 0;
    width: 4px;
    height: 8px;
    border-radius: 0 4px 4px 0;
    background: #fff;
  }
  .channel.big {
    padding: 10px 8px;
    gap: 12px;
    font-weight: 500;
  }
  .dm {
    gap: 12px;
    padding: 6px 8px;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .dm-row {
    position: relative;
  }
  .dm-row .dm {
    padding-right: 30px;
  }
  .remove {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    display: none;
    color: var(--text-muted);
  }
  .remove:hover {
    color: var(--text-strong);
  }
  .dm-row:hover .remove,
  .remove:focus-visible {
    display: flex;
  }
  .voice-user {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 4px 34px;
    color: var(--text-muted);
    font-size: 14px;
  }
  .voice-user :global(svg) {
    color: var(--text-faint);
    flex: none;
  }
  .live {
    background: var(--red);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 5px;
    border-radius: 8px;
  }
  .joining {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    color: var(--text-muted);
    font-size: 14px;
  }
  .empty {
    font-size: 13px;
    color: var(--text-faint);
    padding: 8px;
    line-height: 1.4;
  }
  .voice-panel {
    display: flex;
    align-items: center;
    padding: 8px;
    background: var(--bg-panel);
    border-bottom: 1px solid var(--border-soft);
  }
  .voice-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-left: 4px;
  }
  .connected {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--green);
    font-weight: 600;
    font-size: 14px;
  }
  .connected.connecting {
    color: var(--yellow);
  }
  .where {
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .user-panel {
    height: 52px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    background: var(--bg-panel);
  }
  .user-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding-left: 6px;
  }
  .user-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .user-sub {
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .icon-btn.off {
    color: var(--red);
  }
</style>
