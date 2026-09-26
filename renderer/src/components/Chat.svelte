<script lang="ts">
  import { tick } from 'svelte'
  import Icon from './Icon.svelte'
  import Avatar from './Avatar.svelte'
  import Attachment from './Attachment.svelte'
  import { call, bridge } from '../lib/rpc'
  import {
    ui,
    messagesFor,
    loadOlder,
    markRead,
    memberName,
    dmPartner,
    isOnline,
    toast,
    errorText,
    KIND_DM,
    VOICE,
    ROLE_ADMIN,
    type Message,
    type FileRef
  } from '../lib/state.svelte'
  import { voice, joinVoice } from '../lib/voice/call.svelte'
  import { renderText, isEmojiOnly, formatTime, formatDay, formatStamp } from '../lib/format'

  let { compact = false }: { compact?: boolean } = $props()

  let space = $derived(ui.chat ? ui.spaces[ui.chat.space] : undefined)
  let channel = $derived(space?.channels.find((c) => c.id === ui.chat?.channel))
  let isDm = $derived(space?.kind === KIND_DM)
  let partner = $derived(space && isDm ? dmPartner(space) : null)
  let messages = $derived(ui.chat ? messagesFor(ui.chat.space, ui.chat.channel) : [])
  let title = $derived(isDm ? partner?.name || 'Warte auf deinen Freund…' : channel?.name || '')

  let scroller: HTMLDivElement | undefined = $state()
  let input: HTMLTextAreaElement | undefined = $state()
  let text = $state('')
  let pending = $state<{ id: number; name: string; ref: FileRef | null; error?: string }[]>([])
  let replyTo = $state<Message | null>(null)
  let editing = $state<string | null>(null)
  let editText = $state('')
  let dragging = $state(0)
  let stick = true
  let lastKey = ''
  let sending = $state(false)

  // Keep the view pinned to the newest message unless the user scrolled up
  $effect(() => {
    const key = ui.chat ? ui.chat.space + ':' + ui.chat.channel : ''
    const count = messages.length
    const last = messages[count - 1]?.id
    void last
    if (key !== lastKey) {
      lastKey = key
      stick = true
      replyTo = null
      editing = null
    }
    if (stick) tick().then(() => scroller && (scroller.scrollTop = scroller.scrollHeight))
    if (ui.chat && document.hasFocus()) markRead(ui.chat.space, ui.chat.channel)
  })

  $effect(() => {
    if (ui.chat && !ui.dialog) tick().then(() => input?.focus())
  })

  async function onScroll () {
    if (!scroller || !ui.chat) return
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40
    if (stick) markRead(ui.chat.space, ui.chat.channel)
    if (scroller.scrollTop < 200) {
      const before = scroller.scrollHeight
      if (await loadOlder(ui.chat.space, ui.chat.channel)) {
        await tick()
        scroller.scrollTop += scroller.scrollHeight - before
      }
    }
  }

  function grouped (list: Message[], i: number) {
    if (i === 0) return false
    const a = list[i - 1]
    const b = list[i]
    return a.author === b.author && b.ts - a.ts < 7 * 60 * 1000 && !b.replyTo && formatDay(a.ts) === formatDay(b.ts)
  }

  function newDay (list: Message[], i: number) {
    return i === 0 || formatDay(list[i - 1].ts) !== formatDay(list[i].ts)
  }

  // ---- sending ----

  let nextUpload = 1

  async function upload (file: File) {
    if (!ui.chat) return
    const id = nextUpload++
    pending.push({ id, name: file.name || 'Bild.png', ref: null })
    try {
      const path = bridge.pathForFile(file)
      let ref: FileRef
      if (path) {
        ref = await call('uploadFile', { id: ui.chat.space, path, name: file.name, mime: file.type || guessMime(file.name) })
      } else {
        const buf = new Uint8Array(await file.arrayBuffer())
        let bin = ''
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
        ref = await call('uploadBytes', { id: ui.chat.space, data: btoa(bin), name: file.name || 'Bild.png', mime: file.type || 'application/octet-stream' })
      }
      const p = pending.find((x) => x.id === id)
      if (p) p.ref = ref
    } catch (err) {
      pending = pending.filter((x) => x.id !== id)
      toast(errorText(err), 'error')
    }
  }

  function guessMime (name: string) {
    const ext = name.split('.').pop()?.toLowerCase() || ''
    const map: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4', opus: 'audio/ogg',
      pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain'
    }
    return map[ext] || 'application/octet-stream'
  }

  async function send () {
    if (!ui.chat || sending) return
    if (pending.some((p) => !p.ref)) {
      toast('Warte, bis alle Dateien hochgeladen sind.')
      return
    }
    const body = text.trim()
    const files = pending.map((p) => $state.snapshot(p.ref!))
    if (!body && !files.length) return
    sending = true
    const { space: id, channel: ch } = ui.chat
    try {
      await call('sendMessage', { id, channel: ch, text: body, files, replyTo: replyTo?.id || null })
      text = ''
      pending = []
      replyTo = null
      stick = true
      autosize()
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      sending = false
    }
  }

  function onKey (e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      send()
    } else if (e.key === 'Escape') {
      replyTo = null
    } else if (e.key === 'ArrowUp' && !text) {
      const mine = [...messages].reverse().find((m) => m.author === ui.me && m.text)
      if (mine) startEdit(mine)
    }
  }

  function autosize () {
    if (!input) return
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 300) + 'px'
  }

  function onPaste (e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files || [])]
    if (files.length) {
      e.preventDefault()
      files.forEach(upload)
    }
  }

  function onDrop (e: DragEvent) {
    e.preventDefault()
    dragging = 0
    ;[...(e.dataTransfer?.files || [])].forEach(upload)
  }

  function pickFiles () {
    const el = document.createElement('input')
    el.type = 'file'
    el.multiple = true
    el.onchange = () => [...(el.files || [])].forEach(upload)
    el.click()
  }

  // ---- editing ----

  function startEdit (m: Message) {
    editing = m.id
    editText = m.text
  }

  async function saveEdit (m: Message) {
    const t = editText.trim()
    editing = null
    if (!ui.chat || t === m.text) return
    if (!t && !m.files.length) return remove(m)
    await call('editMessage', { id: ui.chat.space, channel: m.channel, message: m.id, text: t }).catch((err) => toast(errorText(err), 'error'))
  }

  function remove (m: Message) {
    if (!ui.chat) return
    const { space: id } = ui.chat
    ui.dialog = {
      type: 'confirm',
      title: 'Nachricht löschen',
      text: 'Willst du diese Nachricht wirklich löschen?',
      danger: true,
      action: 'Löschen',
      run: () => call('deleteMessage', { id, channel: m.channel, message: m.id })
    }
  }

  function onMessageClick (e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a[data-href]') as HTMLAnchorElement | null
    if (a) {
      e.preventDefault()
      ui.dialog = { type: 'link', url: a.dataset.href }
      return
    }
    const spoiler = (e.target as HTMLElement).closest('.spoiler')
    if (spoiler) spoiler.classList.add('revealed')
  }

  function callDm () {
    if (!space) return
    const vc = space.channels.find((c) => c.kind === VOICE)
    if (vc) joinVoice(space.id, vc.id)
  }

  function snippet (id: string | null) {
    if (!id) return null
    return messages.find((m) => m.id === id) || null
  }
</script>

<section
  class="chat"
  class:compact
  ondragenter={(e) => { if (e.dataTransfer?.types.includes('Files')) dragging++ }}
  ondragleave={() => dragging = Math.max(0, dragging - 1)}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
  role="region"
  aria-label="Chat"
>
  {#if space && channel}
    <header>
      {#if isDm}
        <Avatar id={partner?.identity || space.id} name={title} size={24} status={partner ? (isOnline(partner.identity) ? 'online' : 'offline') : null} />
      {:else}
        <Icon name="hash" size={22} />
      {/if}
      <span class="title">{title}</span>
      <span class="spacer"></span>
      {#if isDm}
        {#if voice.active?.space !== space.id}
          <button class="icon-btn" title="Anrufen" onclick={callDm} disabled={!partner}><Icon name="phone" size={20} /></button>
        {/if}
        {#if partner}
          <button class="icon-btn" title="Sicherheitsnummer prüfen" onclick={() => (ui.dialog = { type: 'verify', identity: partner!.identity, name: partner!.name })}><Icon name="shield-check" size={20} /></button>
        {:else}
          <button class="icon-btn" title="Einladungscode" onclick={() => (ui.dialog = { type: 'invite', space: space!.id })}><Icon name="user-plus" size={20} /></button>
        {/if}
      {:else}
        <button class="icon-btn" title="Mitglieder" onclick={() => (ui.dialog = { type: 'members', space: space!.id })}><Icon name="users" size={20} /></button>
      {/if}
    </header>

    <div class="messages selectable" bind:this={scroller} onscroll={onScroll} onclick={onMessageClick} role="log">
      {#if ui.hasMore[space.id + ':' + channel.id] === false || messages.length < 50}
        <div class="intro">
          {#if isDm}
            <Avatar id={partner?.identity || space.id} name={title} size={72} />
            <h2>{title}</h2>
            <p>Das ist der Anfang deiner Direktnachrichten mit <strong>{title}</strong>. Alles ist Ende-zu-Ende-verschlüsselt und läuft direkt zwischen euch, ohne Server.</p>
          {:else}
            <div class="intro-icon"><Icon name="hash" size={40} /></div>
            <h2>Willkommen in #{channel.name}!</h2>
            <p>Das ist der Anfang des Kanals #{channel.name} in {space.name}.</p>
          {/if}
        </div>
      {/if}

      {#each messages as m, i (m.id)}
        {#if newDay(messages, i)}
          <div class="day"><span>{formatDay(m.ts)}</span></div>
        {/if}
        {@const reply = snippet(m.replyTo)}
        <article class="msg" class:grouped={grouped(messages, i)} class:mention={false}>
          {#if m.replyTo}
            <div class="reply-ref">
              <span class="reply-line"></span>
              {#if reply}
                <strong>{memberName(space, reply.author)}</strong>
                <span class="reply-text">{reply.text || 'Anhang'}</span>
              {:else}
                <span class="reply-text">Ursprüngliche Nachricht nicht geladen</span>
              {/if}
            </div>
          {/if}
          {#if grouped(messages, i)}
            <span class="gutter-time">{formatTime(m.ts)}</span>
          {:else}
            <div class="avatar"><Avatar id={m.author} name={memberName(space, m.author)} size={40} /></div>
            <div class="meta">
              <span class="author">{memberName(space, m.author)}</span>
              <span class="time" title={new Date(m.ts).toLocaleString('de-DE')}>{formatStamp(m.ts)}</span>
            </div>
          {/if}
          <div class="body">
            {#if editing === m.id}
              <textarea
                class="edit"
                bind:value={editText}
                onkeydown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(m) }
                  if (e.key === 'Escape') editing = null
                }}
              ></textarea>
              <div class="edit-hint">Esc zum Abbrechen · Enter zum Speichern</div>
            {:else if m.text}
              <div class="text" class:jumbo={isEmojiOnly(m.text)}>
                {@html renderText(m.text)}
                {#if m.edited}<span class="edited" title={new Date(m.edited).toLocaleString('de-DE')}>(bearbeitet)</span>{/if}
              </div>
            {/if}
            {#each m.files as f (f.core + f.blockOffset)}
              <Attachment space={space.id} file={f} />
            {/each}
          </div>
          <div class="actions">
            <button title="Antworten" onclick={() => { replyTo = m; input?.focus() }}><Icon name="reply" size={18} /></button>
            {#if m.author === ui.me && m.text}
              <button title="Bearbeiten" onclick={() => startEdit(m)}><Icon name="edit" size={18} /></button>
            {/if}
            {#if m.author === ui.me || space.role >= ROLE_ADMIN}
              <button title="Löschen" class="danger" onclick={() => remove(m)}><Icon name="trash" size={18} /></button>
            {/if}
          </div>
        </article>
      {/each}
      <div class="bottom-pad"></div>
    </div>

    <div class="composer">
      {#if replyTo}
        <div class="replying">
          Antwort an <strong>{memberName(space, replyTo.author)}</strong>
          <span class="spacer"></span>
          <button class="icon-btn" onclick={() => (replyTo = null)} title="Abbrechen"><Icon name="x" size={16} /></button>
        </div>
      {/if}
      {#if pending.length}
        <div class="uploads">
          {#each pending as p (p.id)}
            <div class="upload">
              {#if p.ref}<Icon name="check" size={16} />{:else}<span class="spinner"></span>{/if}
              <span class="uname">{p.name}</span>
              <button onclick={() => (pending = pending.filter((x) => x.id !== p.id))} title="Entfernen"><Icon name="x" size={14} /></button>
            </div>
          {/each}
        </div>
      {/if}
      <div class="box" class:has-top={!!replyTo || pending.length > 0}>
        <button class="attach" title="Datei senden" onclick={pickFiles}><Icon name="plus-circle" size={24} /></button>
        <textarea
          bind:this={input}
          bind:value={text}
          rows="1"
          placeholder={isDm ? `Nachricht an @${title}` : `Nachricht an #${channel.name}`}
          onkeydown={onKey}
          oninput={autosize}
          onpaste={onPaste}
          disabled={isDm && !partner}
        ></textarea>
        <button class="attach" title="Senden" onclick={send} disabled={sending}><Icon name="send" size={20} /></button>
      </div>
    </div>

    {#if dragging > 0}
      <div class="dropzone"><div><Icon name="file" size={40} /><p>Dateien hier ablegen, um sie an {isDm ? title : '#' + channel.name} zu senden</p></div></div>
    {/if}
  {:else}
    <div class="empty">
      <Icon name="chat" size={48} stroke={1.5} />
      <p>{ui.view === 'home' ? 'Füge einen Freund hinzu, um zu chatten.' : 'Wähle einen Kanal aus.'}</p>
    </div>
  {/if}
</section>

<style>
  .chat {
    position: relative;
    flex: 1;
    min-width: 360px;
    display: flex;
    flex-direction: column;
    background: var(--bg-main);
  }
  .chat.compact {
    flex: 0 0 420px;
    width: 420px;
    border-left: 1px solid var(--border);
  }
  header {
    height: 48px;
    min-height: 48px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid var(--border);
    box-shadow: 0 1px 0 rgba(4, 4, 5, 0.2);
    color: var(--text-faint);
  }
  .title {
    color: var(--text-strong);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding-top: 16px;
  }
  .intro {
    padding: 16px;
    margin-bottom: 8px;
  }
  .intro h2 {
    color: var(--text-strong);
    font-size: 28px;
    margin: 8px 0;
  }
  .intro p {
    color: var(--text-muted);
    margin: 0;
  }
  .intro-icon {
    width: 68px;
    height: 68px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: #41434a;
    color: #fff;
  }
  .day {
    display: flex;
    align-items: center;
    margin: 16px 16px 8px;
    height: 0;
    border-top: 1px solid #3f4147;
    justify-content: center;
  }
  .day span {
    background: var(--bg-main);
    padding: 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    transform: translateY(-1px);
  }
  .msg {
    position: relative;
    padding: 2px 48px 2px 72px;
    margin-top: 16px;
    min-height: 44px;
  }
  .msg.grouped {
    margin-top: 0;
    min-height: 0;
  }
  .msg:hover {
    background: rgba(2, 2, 2, 0.06);
  }
  .avatar {
    position: absolute;
    left: 16px;
    top: 4px;
  }
  .reply-ref + .avatar {
    top: 26px;
  }
  .meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .author {
    color: var(--text-strong);
    font-weight: 500;
  }
  .time {
    font-size: 12px;
    color: var(--text-faint);
  }
  .gutter-time {
    position: absolute;
    left: 0;
    width: 64px;
    text-align: right;
    font-size: 11px;
    color: var(--text-faint);
    top: 5px;
    opacity: 0;
  }
  .msg:hover .gutter-time {
    opacity: 1;
  }
  .text {
    white-space: pre-wrap;
    word-wrap: break-word;
    color: var(--text);
  }
  .text.jumbo {
    font-size: 40px;
    line-height: 1.2;
  }
  .text :global(code) {
    font-family: var(--mono);
    font-size: 85%;
    background: #2b2d31;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .text :global(pre) {
    background: #2b2d31;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px;
    margin: 4px 0;
    white-space: pre-wrap;
    max-width: 90%;
  }
  .text :global(pre code) {
    background: none;
    padding: 0;
  }
  .text :global(.spoiler) {
    background: #1e1f22;
    color: transparent;
    border-radius: 3px;
    cursor: pointer;
  }
  .text :global(.spoiler.revealed) {
    color: inherit;
    background: rgba(255, 255, 255, 0.1);
  }
  .edited {
    font-size: 11px;
    color: var(--text-faint);
    margin-left: 4px;
  }
  .reply-ref {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-muted);
    margin-bottom: 2px;
    position: relative;
  }
  .reply-line {
    position: absolute;
    left: -36px;
    top: 9px;
    width: 30px;
    height: 12px;
    border-left: 2px solid #4e5058;
    border-top: 2px solid #4e5058;
    border-top-left-radius: 6px;
  }
  .reply-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    position: absolute;
    right: 16px;
    top: -14px;
    display: none;
    background: var(--bg-main);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
    z-index: 2;
  }
  .msg:hover .actions {
    display: flex;
  }
  .actions button {
    width: 30px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    color: var(--text-muted);
  }
  .actions button:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .actions .danger:hover {
    color: #f23f42;
  }
  .edit {
    width: 100%;
    min-height: 44px;
    background: var(--bg-input);
    border: 0;
    border-radius: 8px;
    padding: 10px 12px;
    resize: vertical;
    outline: none;
  }
  .edit-hint {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 4px;
  }
  .bottom-pad {
    height: 24px;
  }
  .composer {
    padding: 0 16px 20px;
  }
  .replying {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #2b2d31;
    padding: 4px 8px 4px 16px;
    border-radius: 8px 8px 0 0;
    font-size: 13px;
    color: var(--text-muted);
  }
  .uploads {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    background: #2b2d31;
    padding: 10px 12px;
    border-radius: 8px 8px 0 0;
  }
  .replying + .uploads {
    border-radius: 0;
  }
  .upload {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-input);
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
    max-width: 240px;
  }
  .upload :global(svg) {
    color: var(--green);
  }
  .uname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .box {
    display: flex;
    align-items: flex-end;
    background: var(--bg-input);
    border-radius: 8px;
    padding: 0 8px;
  }
  .box.has-top {
    border-radius: 0 0 8px 8px;
  }
  .box textarea {
    flex: 1;
    background: none;
    border: 0;
    outline: none;
    resize: none;
    padding: 11px 8px;
    max-height: 300px;
    line-height: 1.375;
    user-select: text;
  }
  .attach {
    height: 44px;
    width: 36px;
    display: grid;
    place-items: center;
    color: var(--text-muted);
  }
  .attach:hover {
    color: var(--text);
  }
  .dropzone {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: grid;
    place-items: center;
    z-index: 30;
    pointer-events: none;
  }
  .dropzone > div {
    background: var(--accent);
    color: #fff;
    border-radius: 12px;
    padding: 32px 40px;
    text-align: center;
    max-width: 320px;
  }
  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    color: var(--text-faint);
  }
</style>
