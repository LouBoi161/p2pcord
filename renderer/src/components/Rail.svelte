<script lang="ts">
  import Icon from './Icon.svelte'
  import { ui, groups, dms, openView, spaceUnread } from '../lib/state.svelte'
  import { voice } from '../lib/voice/call.svelte'

  let homeUnread = $derived(dms().some((s) => spaceUnread(s)))

  function initials (name: string) {
    return (name || '?')
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 3)
      .toUpperCase()
  }
</script>

<nav class="rail thin-scroll">
  <div class="item" class:active={ui.view === 'home'}>
    <span class="pill" class:unread={homeUnread && ui.view !== 'home'}></span>
    <button class="icon home" title="Direktnachrichten" onclick={() => openView('home')}>
      <Icon name="chat" size={24} />
    </button>
  </div>

  <div class="sep"></div>

  {#each groups() as space (space.id)}
    <div class="item" class:active={ui.view === space.id}>
      <span class="pill" class:unread={spaceUnread(space) && ui.view !== space.id}></span>
      <button class="icon" title={space.name} onclick={() => openView(space.id)}>
        {initials(space.name)}
        {#if voice.active?.space === space.id}
          <span class="in-voice"><Icon name="volume" size={10} stroke={3} /></span>
        {/if}
      </button>
    </div>
  {/each}

  {#if ui.loadingSpaces > 0 && Object.keys(ui.spaces).length === 0}
    <div class="item"><span class="icon loading"><span class="spinner"></span></span></div>
  {/if}

  <div class="item">
    <button class="icon add" title="Gruppe erstellen oder beitreten" onclick={() => (ui.dialog = { type: 'create' })}>
      <Icon name="plus" size={24} />
    </button>
  </div>
</nav>

<style>
  .rail {
    width: 72px;
    min-width: 72px;
    background: var(--bg-rail);
    padding: 12px 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    overflow-y: auto;
  }
  .item {
    position: relative;
    width: 72px;
    display: flex;
    justify-content: center;
  }
  .pill {
    position: absolute;
    left: 0;
    top: 50%;
    width: 4px;
    height: 0;
    border-radius: 0 4px 4px 0;
    background: #fff;
    transform: translateY(-50%);
    transition: height 0.15s;
  }
  .pill.unread {
    height: 8px;
  }
  .item:hover .pill {
    height: 20px;
  }
  .item.active .pill {
    height: 40px;
  }
  .icon {
    position: relative;
    width: 48px;
    height: 48px;
    border-radius: 24px;
    background: var(--bg-main);
    color: var(--text);
    display: grid;
    place-items: center;
    font-weight: 600;
    font-size: 15px;
    transition:
      border-radius 0.15s,
      background 0.15s,
      color 0.15s;
  }
  .item:hover .icon,
  .item.active .icon {
    border-radius: 16px;
    background: var(--accent);
    color: #fff;
  }
  .icon.add {
    color: var(--green);
  }
  .item:hover .icon.add {
    background: var(--green);
    color: #fff;
  }
  .icon.loading {
    background: transparent;
  }
  .sep {
    width: 32px;
    height: 2px;
    border-radius: 1px;
    background: var(--bg-input);
    flex: none;
  }
  .in-voice {
    position: absolute;
    right: -3px;
    bottom: -3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--green);
    border: 3px solid var(--bg-rail);
    display: grid;
    place-items: center;
    color: #fff;
  }
</style>
