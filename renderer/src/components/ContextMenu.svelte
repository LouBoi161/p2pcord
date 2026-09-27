<script lang="ts">
  import MenuList from './MenuList.svelte'
  import { menu, closeMenu } from '../lib/menu.svelte'

  function outside (e: MouseEvent) {
    if (!menu.open) return
    if ((e.target as HTMLElement).closest?.('.menu')) return
    closeMenu()
  }
</script>

<svelte:window
  onmousedown={outside}
  onblur={closeMenu}
  onresize={closeMenu}
  onkeydown={(e) => menu.open && e.key === 'Escape' && (e.stopPropagation(), closeMenu())}
  onwheel={(e) => menu.open && !(e.target as HTMLElement).closest?.('.menu') && closeMenu()}
/>

{#if menu.open}
  {#key menu.items}
    <MenuList items={menu.items} x={menu.x} y={menu.y} />
  {/key}
{/if}
