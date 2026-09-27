<script lang="ts">
  import Icon from './Icon.svelte'
  import { call, bridge } from '../lib/rpc'
  import { ui, toast, type FileRef } from '../lib/state.svelte'
  import { formatSize } from '../lib/format'

  let { space, base, file }: { space: string; base?: string; file: FileRef } = $props()

  // Media up to this size is fetched automatically; anything larger waits for a click
  const AUTO_LIMIT = 25 * 1024 * 1024
  const EXECUTABLE = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|jar|appimage|sh|bash|run|bin|deb|rpm|apk|dmg|pkg|app|command|reg|dll|so|py|pyw)$/i
  let risky = $derived(EXECUTABLE.test(file.name))
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
      const res = await call<{ path: string }>('fetchFile', { id: space, base, file: $state.snapshot(file) })
      url = await bridge.fileUrl(res.path, file.mime)
      rel = res.path
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
    if (risky && !rel) {
      ui.dialog = {
        type: 'confirm',
        title: 'Ausführbare Datei',
        text: `„${file.name}“ ist ein Programm oder Skript. Solche Dateien können deinen PC übernehmen. Lade sie nur herunter, wenn du dem Absender wirklich vertraust und sie erwartet hast.`,
        danger: true,
        action: 'Trotzdem herunterladen',
        run: async () => {
          const r = await fetchIt()
          if (r) await bridge.saveFile(r, file.name)
        }
      }
      return
    }
    const r = await fetchIt()
    if (r) await bridge.saveFile(r, file.name)
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
      {#if risky}<span class="risky">Ausführbare Datei – nur öffnen, wenn du dem Absender vertraust</span>{/if}
      <span class="size">
        {formatSize(file.byteLength)}
        {#if loading} · lädt…{:else if failed} · <button class="retry" onclick={fetchIt}>nicht erreichbar – erneut versuchen</button>{/if}
      </span>
    </div>
    {#if loading}
      <span class="spinner"></span>
    {:else}
      <button class="icon-btn" title="Speichern unter…" onclick={save}>
        <Icon name="download" size={20} />
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
    color: var(--link);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .size {
    font-size: 12px;
  }
  .risky {
    font-size: 12px;
    color: var(--yellow);
  }
  .retry {
    color: var(--link);
    font-size: 12px;
  }
</style>
