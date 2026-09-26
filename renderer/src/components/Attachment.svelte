<script lang="ts">
  import Icon from './Icon.svelte'
  import { call, bridge } from '../lib/rpc'
  import { ui, toast, type FileRef } from '../lib/state.svelte'
  import { formatSize } from '../lib/format'

  let { space, file }: { space: string; file: FileRef } = $props()

  const AUTO_LIMIT = 64 * 1024 * 1024
  let kind = $derived(
    file.mime.startsWith('image/') ? 'image' : file.mime.startsWith('video/') ? 'video' : file.mime.startsWith('audio/') ? 'audio' : 'file'
  )
  let url = $state<string | null>(null)
  let rel = $state<string | null>(null)
  let loading = $state(false)
  let failed = $state(false)

  async function fetchIt () {
    if (loading || rel) return rel
    loading = true
    failed = false
    try {
      const res = await call<{ path: string }>('fetchFile', { id: space, file: $state.snapshot(file) })
      rel = res.path
      url = 'p2pfile://local/' + res.path.split('/').map(encodeURIComponent).join('/')
      return rel
    } catch {
      failed = true
      return null
    } finally {
      loading = false
    }
  }

  $effect(() => {
    if (kind !== 'file' && file.byteLength <= AUTO_LIMIT) fetchIt()
  })

  async function save () {
    const r = await fetchIt()
    if (r) bridge.showFile(r)
    else toast('Datei konnte nicht geladen werden – ist der Absender online?', 'error')
  }

  function open () {
    if (kind === 'image' && url) ui.dialog = { type: 'image', url, name: file.name }
  }
</script>

{#if kind === 'image' && url}
  <button class="media image" onclick={open} title={file.name}>
    <img src={url} alt={file.name} loading="lazy" />
  </button>
{:else if kind === 'video' && url}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video class="media" src={url} controls preload="metadata"></video>
{:else if kind === 'audio' && url}
  <audio src={url} controls preload="metadata"></audio>
{:else}
  <div class="card">
    <Icon name={kind === 'image' ? 'image' : 'file'} size={30} stroke={1.5} />
    <div class="meta">
      <span class="name" title={file.name}>{file.name}</span>
      <span class="size">
        {formatSize(file.byteLength)}
        {#if loading} · lädt…{:else if failed} · <button class="retry" onclick={fetchIt}>nicht erreichbar – erneut versuchen</button>{/if}
      </span>
    </div>
    {#if loading}
      <span class="spinner"></span>
    {:else}
      <button class="icon-btn" title={rel ? 'Im Ordner zeigen' : 'Herunterladen'} onclick={save}>
        <Icon name={rel ? 'folder' : 'download'} size={20} />
      </button>
    {/if}
  </div>
{/if}

<style>
  .media {
    display: block;
    max-width: min(100%, 440px);
    max-height: 340px;
    border-radius: 8px;
    margin-top: 6px;
    background: #000;
  }
  .image {
    padding: 0;
    overflow: hidden;
    background: transparent;
  }
  .image img {
    display: block;
    max-width: 100%;
    max-height: 340px;
    border-radius: 8px;
    object-fit: contain;
  }
  audio {
    margin-top: 6px;
    width: min(100%, 400px);
  }
  .card {
    display: flex;
    align-items: center;
    gap: 10px;
    width: min(100%, 420px);
    padding: 12px;
    margin-top: 6px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-muted);
  }
  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    color: #00a8fc;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    font-size: 12px;
  }
  .retry {
    color: #00a8fc;
    font-size: 12px;
  }
</style>
