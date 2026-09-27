<script lang="ts">
  // TeamSpeak 6 layout: a text navigator instead of the icon rail. Groups
  // ("servers"), direct chats, your own status and the voice connection.
  import Icon from './Icon.svelte'
  import Avatar from './Avatar.svelte'
  import Logo from './Logo.svelte'
  import {
    ui,
    groups,
    dms,
    openView,
    openDm,
    spaceUnread,
    dmPartner,
    isOnline,
    memberName,
    cancelJoin,
    KIND_DM,
    type Space
  } from '../lib/state.svelte'
  import { voice, leaveVoice, toggleMute, toggleDeaf } from '../lib/voice/call.svelte'
  import { settings, saveSettings } from '../lib/settings.svelte'
  import { spaceMenu, dmMenu, userMenu, isChatMuted } from '../lib/menus'

  let activeSpace = $derived(voice.active ? ui.spaces[voice.active.space] : undefined)
  let activeChannel = $derived(activeSpace?.channels.find((c) => c.id === voice.active?.channel))

  function toggle (key: string) {
    if (settings.collapsed[key]) delete settings.collapsed[key]
    else settings.collapsed[key] = true
    saveSettings()
  }

  function initials (name: string) {
    return (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
  }

  const dmLabel = (s: Space) => dmPartner(s)?.name || 'Warte auf Freund…'
</script>

<nav class="nav">
  <div class="top">
    <Logo size={26} />
    <span class="brand">P2Pcord</span>
    <span class="spacer"></span>
    <button class="t" class:off={voice.muted} title={voice.muted ? 'Stummschaltung aufheben' : 'Stummschalten'} onclick={toggleMute}><Icon name={voice.muted ? 'mic-off' : 'mic'} size={16} /></button>
    <button class="t" class:off={voice.deaf} title={voice.deaf ? 'Ton an' : 'Ton aus'} onclick={toggleDeaf}><Icon name={voice.deaf ? 'headphones-off' : 'headphones'} size={16} /></button>
  </div>

  <div class="scroll thin-scroll">
    <div class="sec">
      <button class="fold" onclick={() => toggle('nav:groups')}>
        <Icon name={settings.collapsed['nav:groups'] ? 'chevron-right' : 'chevron-down'} size={12} stroke={3} /> Gruppen
      </button>
      <button class="add" title="Gruppe erstellen oder beitreten" onclick={() => (ui.dialog = { type: 'create' })}><Icon name="plus" size={15} /></button>
    </div>
    {#if !settings.collapsed['nav:groups']}
      {#each groups() as g (g.id)}
        <button class="row" class:active={ui.view === g.id} class:unread={spaceUnread(g) && ui.view !== g.id && !isChatMuted(g.id)} onclick={() => openView(g.id)} oncontextmenu={(e) => spaceMenu(e, g)}>
          <span class="gicon">{initials(g.name)}</span>
          <span class="name">{g.name}</span>
          {#if voice.active?.space === g.id}<Icon name="volume" size={14} />{/if}
        </button>
      {:else}
        <p class="empty">Noch keine Gruppe.</p>
      {/each}
    {/if}

    <div class="sec">
      <button class="fold" onclick={() => toggle('nav:chats')}>
        <Icon name={settings.collapsed['nav:chats'] ? 'chevron-right' : 'chevron-down'} size={12} stroke={3} /> Chats
      </button>
      <button class="add" title="Freund hinzufügen" onclick={() => (ui.dialog = { type: 'friend' })}><Icon name="user-plus" size={15} /></button>
    </div>
    {#if !settings.collapsed['nav:chats']}
      {#each ui.joining as code (code)}
        <div class="row joining"><span class="spinner"></span><span class="name">Trete bei…</span><button class="add" title="Abbrechen" onclick={() => cancelJoin(code)}><Icon name="x" size={14} /></button></div>
      {/each}
      {#each dms() as dm (dm.id)}
        {@const partner = dmPartner(dm)}
        <button
          class="row"
          class:active={ui.view === 'home' && ui.chat?.space === dm.id}
          class:unread={spaceUnread(dm) && ui.chat?.space !== dm.id && !isChatMuted(dm.id)}
          onclick={() => openDm(dm.id)}
          oncontextmenu={(e) => dmMenu(e, dm)}
        >
          <Avatar id={partner?.identity || dm.id} name={dmLabel(dm)} size={22} status={partner ? (isOnline(partner.identity) ? 'online' : 'offline') : null} />
          <span class="name">{dmLabel(dm)}</span>
          {#if voice.active?.space === dm.id}<Icon name="volume" size={14} />{/if}
        </button>
      {/each}
      <button class="row link" onclick={() => (ui.dialog = { type: 'create', tab: 'join' })}><Icon name="ticket" size={16} /> <span class="name">Code einlösen</span></button>
    {/if}
  </div>

  {#if voice.active || voice.joining}
    <div class="voice">
      <div class="vinfo">
        <span class="vstate" class:connecting={voice.joining}><Icon name="signal" size={14} stroke={2.5} /> {voice.joining ? 'Verbinde…' : 'Verbunden'}</span>
        {#if activeSpace && activeChannel}
          <span class="where">{activeChannel.name} · {activeSpace.kind === KIND_DM ? memberName(activeSpace, dmPartner(activeSpace)?.identity || '') : activeSpace.name}</span>
        {/if}
      </div>
      <button class="t leave" title="Trennen" onclick={() => leaveVoice()}><Icon name="phone-off" size={16} /></button>
    </div>
  {/if}

  <div class="me" role="presentation" oncontextmenu={(e) => userMenu(e, ui.me)}>
    <Avatar id={ui.me} name={ui.name} size={30} status="online" speaking={!!voice.speaking[ui.me]} />
    <span class="name strong">{ui.name}</span>
    <button class="t" title="Einstellungen" onclick={() => (ui.dialog = { type: 'settings' })}><Icon name="settings" size={18} /></button>
  </div>
</nav>

<style>
  .nav {
    width: 232px;
    min-width: 232px;
    background: var(--bg-rail);
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
  }
  .top {
    height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px 0 12px;
  }
  .brand {
    font-weight: 700;
    font-size: 17px;
    color: var(--accent-text);
    letter-spacing: -0.01em;
  }
  .spacer {
    flex: 1;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 6px 12px;
  }
  .sec {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 4px 4px 6px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .fold {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  .fold:hover {
    color: var(--text);
  }
  .add {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 4px;
    color: var(--accent-text);
  }
  .add:hover {
    background: var(--bg-hover);
  }
  .row {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    color: var(--text);
    font-size: 14px;
    text-align: left;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .row.active {
    background: var(--bg-active);
    color: var(--text-strong);
  }
  .row.unread {
    font-weight: 600;
    color: var(--text-strong);
  }
  .row.unread::after {
    content: '';
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .row :global(svg) {
    flex: none;
    color: var(--text-muted);
  }
  .row.link {
    color: var(--accent-text);
    font-size: 13px;
  }
  .row.link :global(svg) {
    color: var(--accent-text);
  }
  .row.joining {
    color: var(--text-muted);
  }
  .gicon {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    flex: none;
    display: grid;
    place-items: center;
    font-size: 10px;
    font-weight: 700;
    background: var(--bg-tile);
    color: var(--text-strong);
  }
  .row.active .gicon {
    background: var(--accent);
    color: var(--on-accent);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .strong {
    font-weight: 600;
    color: var(--text-strong);
  }
  .empty {
    margin: 4px 8px;
    font-size: 12px;
    color: var(--text-faint);
  }
  .t {
    width: 28px;
    height: 28px;
    border-radius: 5px;
    display: grid;
    place-items: center;
    color: var(--text-muted);
    flex: none;
  }
  .t:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .t.off {
    color: var(--red);
  }
  .t.leave:hover {
    background: var(--red);
    color: #fff;
  }
  .voice {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 8px 6px;
    padding: 8px 6px 8px 10px;
    border-radius: 8px;
    background: var(--bg-panel);
  }
  .vinfo {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .vstate {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--green);
    font-weight: 600;
    font-size: 13px;
  }
  .vstate.connecting {
    color: var(--yellow);
  }
  .where {
    font-size: 12px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .me {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 10px 12px;
    border-top: 1px solid var(--border-soft);
  }
</style>
