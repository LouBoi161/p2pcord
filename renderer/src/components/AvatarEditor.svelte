<script lang="ts">
  // Pick an image, move and zoom it inside the circle, save a 256 px WebP.
  // Also sets the color of the initials avatar for people without a picture.
  import Icon from './Icon.svelte'
  import Avatar from './Avatar.svelte'
  import { ui, setAvatar, toast, errorText } from '../lib/state.svelte'
  import { AVATAR_COLORS, avatarColor } from '../lib/colors'

  const SIZE = 256
  const VIEW = 200
  const MAX_BYTES = 45 * 1024

  let img = $state<HTMLImageElement | null>(null)
  let zoom = $state(1)
  let dx = $state(0)
  let dy = $state(0)
  let busy = $state(false)
  let drag: { x: number; y: number; dx: number; dy: number } | null = null
  let dragging = $state(false)

  // the image covers the circle at zoom 1
  let base = $derived(img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1)
  let w = $derived(img ? img.naturalWidth * base * zoom : 0)
  let h = $derived(img ? img.naturalHeight * base * zoom : 0)

  function clamp () {
    const mx = Math.max(0, (w - VIEW) / 2)
    const my = Math.max(0, (h - VIEW) / 2)
    dx = Math.max(-mx, Math.min(mx, dx))
    dy = Math.max(-my, Math.min(my, dy))
  }

  function load (file: File | undefined | null) {
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    const el = new Image()
    el.onload = () => {
      img = el
      zoom = 1
      dx = 0
      dy = 0
    }
    el.onerror = () => toast('Das Bild konnte nicht gelesen werden.', 'error')
    el.src = url
  }

  function pick () {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/avif'
    input.onchange = () => load(input.files?.[0])
    input.click()
  }

  function down (e: PointerEvent) {
    if (!img) return
    drag = { x: e.clientX, y: e.clientY, dx, dy }
    dragging = true
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function move (e: PointerEvent) {
    if (!drag) return
    dx = drag.dx + e.clientX - drag.x
    dy = drag.dy + e.clientY - drag.y
    clamp()
  }

  function up () {
    drag = null
    dragging = false
  }

  function wheel (e: WheelEvent) {
    if (!img) return
    e.preventDefault()
    zoom = Math.max(1, Math.min(4, zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
    clamp()
  }

  async function encode (canvas: HTMLCanvasElement): Promise<Blob> {
    for (const q of [0.9, 0.8, 0.7, 0.55, 0.4]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', q))
      if (blob && blob.size <= MAX_BYTES) return blob
    }
    throw new Error('IMAGE_TOO_LARGE')
  }

  async function save () {
    if (!img) return
    busy = true
    try {
      const canvas = document.createElement('canvas')
      canvas.width = SIZE
      canvas.height = SIZE
      const g = canvas.getContext('2d')!
      const f = SIZE / VIEW
      g.imageSmoothingQuality = 'high'
      g.drawImage(img, (VIEW / 2 - w / 2 + dx) * f, (VIEW / 2 - h / 2 + dy) * f, w * f, h * f)
      const blob = await encode(canvas)
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      await setAvatar(btoa(bin), 'image/webp')
      img = null
      toast('Profilbild gespeichert')
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      busy = false
    }
  }

  async function remove () {
    await setAvatar(null).catch((err) => toast(errorText(err), 'error'))
  }

  async function color (c: string) {
    await setAvatar(undefined, undefined, c).catch((err) => toast(errorText(err), 'error'))
  }
</script>

<svelte:window onpaste={(e) => load(e.clipboardData?.files?.[0])} />

<div class="editor">
  {#if img}
    <div
      class="crop"
      class:dragging
      style="width:{VIEW}px; height:{VIEW}px"
      role="presentation"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointercancel={up}
      onwheel={wheel}
    >
      <img src={img.src} alt="" draggable="false" style="width:{w}px; height:{h}px; transform: translate({dx}px, {dy}px)" />
    </div>
    <div class="side">
      <label class="field">
        <span>Zoom</span>
        <input type="range" min="1" max="4" step="0.01" bind:value={zoom} oninput={clamp} />
      </label>
      <p class="hint">Bild verschieben: ziehen. Zoomen: Mausrad oder Regler.</p>
      <div class="row">
        <button class="btn" onclick={save} disabled={busy}>{#if busy}<span class="spinner"></span>{/if} Speichern</button>
        <button class="btn ghost" onclick={() => (img = null)}>Abbrechen</button>
      </div>
    </div>
  {:else}
    <div class="current" role="presentation" ondragover={(e) => e.preventDefault()} ondrop={(e) => { e.preventDefault(); load(e.dataTransfer?.files?.[0]) }}>
      <Avatar id={ui.me} name={ui.name} size={96} />
    </div>
    <div class="side">
      <div class="row">
        <button class="btn" onclick={pick}><Icon name="camera" size={16} /> Bild wählen</button>
        {#if ui.avatars[ui.me]}<button class="btn secondary" onclick={remove}>Entfernen</button>{/if}
      </div>
      <p class="hint">Oder ein Bild hierher ziehen bzw. mit Strg+V einfügen. Es wird auf 256 × 256 verkleinert und nur an deine Freunde geschickt.</p>
      <div class="label">Farbe {ui.avatars[ui.me] ? '(ohne Bild)' : ''}</div>
      <div class="colors">
        <button class="c auto" class:active={!ui.myColor} title="Automatisch" style="--c:{avatarColor(ui.me)}" onclick={() => color('')}>A</button>
        {#each AVATAR_COLORS as c (c)}
          <button class="c" class:active={ui.myColor === c} style="--c:{c}" title={c} onclick={() => color(c)} aria-label={c}></button>
        {/each}
        <label class="c custom" title="Eigene Farbe" style="--c:{ui.myColor || '#888888'}">
          <input type="color" value={ui.myColor || '#888888'} onchange={(e) => color((e.target as HTMLInputElement).value)} />
          <Icon name="palette" size={14} />
        </label>
      </div>
    </div>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    gap: 24px;
    align-items: center;
    flex-wrap: wrap;
  }
  .crop {
    position: relative;
    border-radius: 50%;
    overflow: hidden;
    background: var(--bg-rail);
    cursor: grab;
    display: grid;
    place-items: center;
    flex: none;
    touch-action: none;
    box-shadow: 0 0 0 3px var(--accent);
  }
  .crop.dragging {
    cursor: grabbing;
  }
  .crop img {
    position: absolute;
    max-width: none;
    user-select: none;
    pointer-events: none;
  }
  .current {
    flex: none;
  }
  .side {
    flex: 1;
    min-width: 220px;
  }
  .row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .hint {
    margin: 10px 0;
  }
  .label {
    margin: 12px 0 8px;
  }
  .colors {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .c {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--c);
    display: grid;
    place-items: center;
    color: #fff;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    position: relative;
  }
  .c.active {
    box-shadow: 0 0 0 2px var(--bg-main), 0 0 0 4px var(--text-strong);
  }
  .c.custom input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
</style>
