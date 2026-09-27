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
  import { voice, participants, peerVoice, joinVoice, leaveVoice, toggleMute, toggleDeaf, watchStream } from '../lib/voice/call.svelte'
  import { settings, saveSettings } from '../lib/settings.svelte'
  import { userMenu, channelMenu, spaceMenu, dmMenu, isChatMuted } from '../lib/menus'

  let space = $derived(ui.view !== 'home' ? ui.spaces[ui.view] : undefined)
  let menuOpen = $state(false)
  let isAdmin = $derived(!!space && space.role >= ROLE_ADMIN)
  let textKey = $derived((space?.id || '') + ':text')
  let voiceKey = $derived((space?.id || '') + ':voice')

  let activeSpace = $derived(voice.active ? ui.spaces[voice.active.space] : undefined)
  let activeChannel = $derived(activeSpace?.channels.find((c) => c.id === voice.active?.channel))

  function menu (type: string) {
    menuOpen = false
    ui.dialog = { type, space: ui.view }
  }

  function dmLabel (s: Space) {
    return dmPartner(s)?.name || 'Warte auf Freund…'
  }

  // Collapsed sections keep what matters visible: the open/unread text channel, occupied voice channels
  function toggle (key: string) {
    if (settings.collapsed[key]) delete settings.collapsed[key]
    else settings.collapsed[key] = true
    saveSettings()
  }
</script>

<svelte:window onclick={() => (menuOpen = false)} />

<aside class="sidebar">
  {#if space}
    <header class="head clickable" onclick={(e) => { e.stopPropagation(); menuOpen = !menuOpen }} oncontextmenu={(e) => spaceMenu(e, space)} role="button" tabindex="0" onkeydown={() => {}}>
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
        <button class="fold" onclick={() => toggle(textKey)} aria-expanded={!settings.collapsed[textKey]}>
          <Icon name={settings.collapsed[textKey] ? 'chevron-right' : 'chevron-down'} size={12} stroke={3} />
          <span>Textkanäle</span>
        </button>
        {#if isAdmin}<button class="add" title="Kanal erstellen" onclick={() => (ui.dialog = { type: 'channel', space: space.id, kind: TEXT })}><Icon name="plus" size={16} /></button>{/if}
      </div>
      {#each space.channels.filter((c) => c.kind === TEXT) as ch (ch.id)}
        {@const isUnread = unread(space, ch) && ui.chat?.channel !== ch.id}
        {#if !settings.collapsed[textKey] || ui.chat?.channel === ch.id || isUnread}
          <button
            class="channel"
            class:active={ui.chat?.channel === ch.id}
            class:unread={isUnread && !isChatMuted(space.id, ch.id)}
            class:muted={isChatMuted(space.id, ch.id)}
            onclick={() => openChannel(space.id, ch.id)}
            oncontextmenu={(e) => channelMenu(e, space, ch)}
          >
            <Icon name="hash" size={20} />
            <span class="name">{ch.name}</span>
          </button>
        {/if}
      {/each}

      <div class="section">
        <button class="fold" onclick={() => toggle(voiceKey)} aria-expanded={!settings.collapsed[voiceKey]}>
          <Icon name={settings.collapsed[voiceKey] ? 'chevron-right' : 'chevron-down'} size={12} stroke={3} />
          <span>Sprachkanäle</span>
        </button>
        {#if isAdmin}<button class="add" title="Sprachkanal erstellen" onclick={() => (ui.dialog = { type: 'channel', space: space.id, kind: VOICE })}><Icon name="plus" size={16} /></button>{/if}
      </div>
      {#each space.channels.filter((c) => c.kind === VOICE) as ch (ch.id)}
        {@const inside = participants(space.id, ch.id)}
        {#if !settings.collapsed[voiceKey] || inside.length}
          <button
            class="channel"
            class:active={voice.active?.channel === ch.id}
            onclick={() => joinVoice(space.id, ch.id)}
            oncontextmenu={(e) => channelMenu(e, space, ch)}
            title="Beitreten"
          >
            <Icon name="volume" size={20} />
            <span class="name">{ch.name}</span>
          </button>
          {#each inside as id (id)}
            {@const v = peerVoice(id)}
            <div class="voice-user" role="presentation" oncontextmenu={(e) => userMenu(e, id, space.id)}>
              <Avatar {id} name={memberName(space, id)} size={settings.layout === 'teamspeak' ? 20 : 24} speaking={!!voice.speaking[id]} />
              <span class="name">{memberName(space, id)}</span>
              {#if v?.screen}
                {#if id !== ui.me && voice.active?.space === space.id && voice.active.channel === ch.id}
                  <button class="live" title={voice.watching[id] ? 'Nicht mehr zuschauen' : 'Stream ansehen'} onclick={() => watchStream(id, !voice.watching[id])}>LIVE</button>
                {:else}
                  <span class="live">LIVE</span>
                {/if}
              {/if}
              {#if v?.video}<Icon name="video" size={14} />{/if}
              {#if v?.deaf}<Icon name="headphones-off" size={14} />{:else if v?.muted}<Icon name="mic-off" size={14} />{:else if settings.localMutes[id]}<Icon name="volume-x" size={14} />{/if}
            </div>
          {/each}
        {/if}
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
          <span class="name" title={ui.slowJoins[code] ? 'Dauert es länger? Wer den Code erstellt hat, muss P2Pcord geöffnet haben.' : ''}>{ui.slowJoins[code] ? 'Warte auf Einladenden…' : 'Trete bei…'}</span>
          <button class="icon-btn" title="Abbrechen" onclick={() => cancelJoin(code)}><Icon name="x" size={16} /></button>
        </div>
      {/each}

      <div class="section"><span>Direktnachrichten</span></div>
      {#each dms() as dm (dm.id)}
        {@const partner = dmPartner(dm)}
        <div class="dm-row" role="presentation" oncontextmenu={(e) => dmMenu(e, dm)}>
          <button
            class="dm"
            class:active={ui.chat?.space === dm.id}
            class:unread={spaceUnread(dm) && ui.chat?.space !== dm.id && !isChatMuted(dm.id)}
            class:muted={isChatMuted(dm.id)}
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

  {#if space && isAdmin}
    <div class="ts-create"><button class="btn small" onclick={() => (ui.dialog = { type: 'channel', space: space.id })}><Icon name="plus-circle" size={16} /> Kanal erstellen</button></div>
  {/if}
  {#if settings.layout !== 'teamspeak' && (voice.active || voice.joining)}
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

  {#if settings.layout !== 'teamspeak'}
  <div class="user-panel" role="presentation" oncontextmenu={(e) => userMenu(e, ui.me)}>
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
  {/if}
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
    color: var(--on-accent);
  }
  .menu .accent {
    color: var(--accent-text);
  }
  .menu .danger {
    color: var(--red-text);
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
  .fold {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: -6px;
    font: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    color: inherit;
  }
  .fold:hover {
    color: var(--text);
  }
  .channel.muted,
  .dm.muted {
    opacity: 0.55;
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
    background: var(--text-strong);
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
  button.live:hover {
    filter: brightness(1.2);
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

  /* TeamSpeak 6 layout: group card on top, channels as banners, people nested below */
  .ts-create {
    display: none;
  }
  :global([data-layout='teamspeak']) .sidebar {
    width: 300px;
    min-width: 260px;
  }
  :global([data-layout='teamspeak']) .head {
    height: 64px;
    min-height: 64px;
    margin: 12px 12px 4px;
    border: 0;
    border-radius: 10px;
    box-shadow: none;
    background: var(--bg-panel);
    font-size: 16px;
  }
  :global([data-layout='teamspeak']) .menu {
    top: 82px;
  }
  :global([data-layout='teamspeak']) .list {
    padding: 4px 12px 12px;
  }
  :global([data-layout='teamspeak']) .channel {
    padding: 7px 10px;
    margin: 6px 0 2px;
    border-radius: 6px;
    font-size: 14px;
    color: var(--text);
    background: linear-gradient(90deg, var(--bg-panel) 55%, color-mix(in srgb, var(--accent) 22%, var(--bg-panel)));
  }
  :global([data-layout='teamspeak']) .channel:hover {
    background: linear-gradient(90deg, var(--bg-panel) 40%, color-mix(in srgb, var(--accent) 35%, var(--bg-panel)));
  }
  :global([data-layout='teamspeak']) .channel.active {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 70%, transparent);
    color: var(--text-strong);
  }
  :global([data-layout='teamspeak']) .channel :global(svg) {
    width: 16px;
    height: 16px;
  }
  :global([data-layout='teamspeak']) .channel.unread::before {
    left: -6px;
  }
  :global([data-layout='teamspeak']) .section {
    padding: 12px 2px 0;
    font-size: 11px;
  }
  :global([data-layout='teamspeak']) .voice-user {
    margin: 1px 0 1px 10px;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 14px;
    color: var(--text);
  }
  :global([data-layout='teamspeak']) .voice-user:hover {
    background: var(--bg-hover);
  }
  :global([data-layout='teamspeak']) .ts-create {
    display: flex;
    justify-content: center;
    padding: 10px;
    border-top: 1px solid var(--border-soft);
  }
  .ts-create .btn {
    border-radius: 18px;
    height: 32px;
  }
</style>
