<script lang="ts">
  import Icon from './Icon.svelte'
  import MenuList from './MenuList.svelte'
  import { closeMenu, type MenuItem, type SliderItem } from '../lib/menu.svelte'

  let { items, x, y, anchor = null }: { items: MenuItem[]; x: number; y: number; anchor?: DOMRect | null } = $props()

  let el: HTMLDivElement | undefined = $state()
  let left = $state(0)
  let top = $state(0)
  let sub = $state<{ index: number; rect: DOMRect } | null>(null)
  let subTimer: ReturnType<typeof setTimeout> | null = null
  let values = $state<Record<number, number>>({})
  let hasChecks = $derived(items.some((i) => (i.type === undefined || i.type === 'item') && i.checked !== undefined))

  // Keep the menu inside the window; submenus flip to the left when needed
  $effect(() => {
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const W = window.innerWidth
    const H = window.innerHeight
    if (anchor) {
      left = anchor.right + w + 4 > W ? Math.max(4, anchor.left - w - 4) : anchor.right + 4
      top = Math.max(4, Math.min(anchor.top - 6, H - h - 4))
    } else {
      left = Math.max(4, x + w > W - 4 ? x - w : x)
      top = Math.max(4, y + h > H - 4 ? Math.max(4, H - h - 4) : y)
    }
  })

  function enter (i: number, e: MouseEvent) {
    if (subTimer) clearTimeout(subTimer)
    const item = items[i]
    if (item.type === 'sub') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      subTimer = setTimeout(() => (sub = { index: i, rect }), sub ? 120 : 0)
    } else if (sub) {
      subTimer = setTimeout(() => (sub = null), 200)
    }
  }

  function run (item: MenuItem) {
    if ((item.type === undefined || item.type === 'item') && !item.disabled) {
      closeMenu()
      item.action()
    }
  }

  function slide (i: number, item: SliderItem, e: Event) {
    const v = +(e.target as HTMLInputElement).value
    values[i] = v
    item.oninput(v)
  }
</script>

<div class="menu" bind:this={el} style="left:{left}px; top:{top}px" role="menu" tabindex="-1" oncontextmenu={(e) => e.preventDefault()}>
  {#each items as item, i (i)}
    {#if item.type === 'sep'}
      <div class="sep"></div>
    {:else if item.type === 'header'}
      <div class="header">{item.label}</div>
    {:else if item.type === 'slider'}
      {@const v = values[i] ?? item.value}
      <div class="slider" role="presentation" onmouseenter={(e) => enter(i, e)}>
        <div class="slider-label"><span>{item.label}</span><span>{item.format ? item.format(v) : v}</span></div>
        <input type="range" min={item.min} max={item.max} step={item.step} value={v} oninput={(e) => slide(i, item, e)} onchange={() => item.onchange?.()} />
      </div>
    {:else if item.type === 'sub'}
      <button class="item" class:open={sub?.index === i} role="menuitem" onmouseenter={(e) => enter(i, e)} onclick={(e) => enter(i, e)}>
        {#if hasChecks}<span class="check"></span>{/if}
        <span class="lbl">{item.label}</span>
        <Icon name="chevron-right" size={16} />
      </button>
    {:else}
      <button class="item" class:danger={item.danger} disabled={item.disabled} role="menuitem" onmouseenter={(e) => enter(i, e)} onclick={() => run(item)}>
        {#if hasChecks}<span class="check">{#if item.checked}<Icon name="check" size={14} stroke={3} />{/if}</span>{/if}
        <span class="lbl">{item.label}</span>
        {#if item.icon}<Icon name={item.icon} size={16} />{/if}
      </button>
    {/if}
  {/each}
</div>

{#if sub}
  {@const s = items[sub.index]}
  {#if s && s.type === 'sub'}
    <MenuList items={s.items as MenuItem[]} x={0} y={0} anchor={sub.rect} />
  {/if}
{/if}

<style>
  .menu {
    position: fixed;
    z-index: 300;
    min-width: 200px;
    max-width: 320px;
    max-height: calc(100vh - 8px);
    overflow-y: auto;
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--bg-float);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    border: 1px solid var(--border-soft);
    display: flex;
    flex-direction: column;
    font-size: 14px;
    animation: pop 0.08s ease-out;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    min-height: 32px;
    border-radius: 3px;
    color: var(--text);
    text-align: left;
  }
  .item:hover:not(:disabled),
  .item.open {
    background: var(--accent);
    color: var(--on-accent);
  }
  .item:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .item.danger {
    color: var(--red-text);
  }
  .item.danger:hover {
    background: var(--red);
    color: #fff;
  }
  .lbl {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    width: 16px;
    display: grid;
    place-items: center;
    flex: none;
  }
  .sep {
    height: 1px;
    background: var(--border-soft);
    margin: 4px;
    flex: none;
  }
  .header {
    padding: 6px 8px 2px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--text-muted);
  }
  .slider {
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .slider-label {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-muted);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
  }
</style>
