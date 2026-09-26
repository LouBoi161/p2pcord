<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  let {
    title,
    subtitle = '',
    width = 440,
    onclose,
    children,
    footer
  }: { title: string; subtitle?: string; width?: number; onclose: () => void; children: Snippet; footer?: Snippet } = $props()
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="backdrop" role="presentation" onmousedown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" style="width:{width}px" role="dialog" aria-modal="true" aria-label={title}>
    <button class="close" onclick={onclose} title="Schließen"><Icon name="x" size={22} /></button>
    <div class="content">
      <h2>{title}</h2>
      {#if subtitle}<p class="subtitle">{subtitle}</p>{/if}
      {@render children()}
    </div>
    {#if footer}
      <div class="footer">{@render footer()}</div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: grid;
    place-items: center;
    z-index: 100;
    animation: fade 0.12s ease-out;
  }
  .modal {
    position: relative;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    background: var(--bg-main);
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    animation: pop 0.15s ease-out;
  }
  .content {
    padding: 24px 16px 8px;
    overflow-y: auto;
  }
  h2 {
    margin: 0 0 8px;
    text-align: center;
    color: var(--text-strong);
    font-size: 22px;
  }
  .subtitle {
    margin: 0 0 20px;
    text-align: center;
    color: var(--text-muted);
    font-size: 15px;
  }
  .close {
    position: absolute;
    top: 12px;
    right: 12px;
    color: var(--text-muted);
    z-index: 1;
  }
  .close:hover {
    color: var(--text);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 16px;
    background: var(--bg-sidebar);
    border-radius: 0 0 8px 8px;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.96);
      opacity: 0;
    }
  }
</style>
