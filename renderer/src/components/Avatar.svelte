<script lang="ts">
  import { personColor } from '../lib/colors'
  import { ui } from '../lib/state.svelte'

  let {
    id,
    name,
    size = 32,
    status = null,
    speaking = false
  }: { id: string; name: string; size?: number; status?: 'online' | 'offline' | null; speaking?: boolean } = $props()

  let color = $derived(personColor(id))
  let image = $derived(ui.avatars[id] || null)
  let initials = $derived(
    (name || '?')
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  )
</script>

<div class="avatar" class:speaking style="--size:{size}px; --color:{color}">
  {#if image}
    <img src={image} alt="" draggable="false" />
  {:else}
    <span>{initials}</span>
  {/if}
  {#if status}
    <i class="status {status}"></i>
  {/if}
</div>

<style>
  .avatar {
    position: relative;
    width: var(--size);
    height: var(--size);
    min-width: var(--size);
    border-radius: 50%;
    background: var(--color);
    display: grid;
    place-items: center;
    color: #fff;
    font-weight: 600;
    font-size: calc(var(--size) * 0.38);
    transition: box-shadow 0.12s;
  }
  .avatar.speaking {
    box-shadow:
      0 0 0 2px var(--bg-sidebar),
      0 0 0 4px var(--green);
  }
  span {
    line-height: 1;
  }
  img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }
  .status {
    position: absolute;
    right: -2px;
    bottom: -2px;
    width: calc(var(--size) * 0.36);
    height: calc(var(--size) * 0.36);
    min-width: 10px;
    min-height: 10px;
    border-radius: 50%;
    border: 3px solid var(--bg-sidebar);
    background: var(--text-faint);
  }
  .status.online {
    background: var(--green);
  }
</style>
