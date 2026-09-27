<script lang="ts">
  import { tick } from 'svelte'
  import Icon from './Icon.svelte'
  import Avatar from './Avatar.svelte'
  import Attachment from './Attachment.svelte'
  import { call, on, bridge } from '../lib/rpc'
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
  import { openMenu } from '../lib/menu.svelte'
  import { userMenu, copy } from '../lib/menus'
  import { settings, saveSettings } from '../lib/settings.svelte'
  import { nameColor } from '../lib/colors'

  let { compact = false, stacked = false, onback }: { compact?: boolean; stacked?: boolean; onback?: () => void } = $props()

  let space = $derived(ui.chat ? ui.spaces[ui.chat.space] : undefined)
  let channel = $derived(space?.channels.find((c) => c.id === ui.chat?.channel))
  let isDm = $derived(space?.kind === KIND_DM)
  let partner = $derived(space && isDm ? dmPartner(space) : null)
  let messages = $derived(ui.chat ? messagesFor(ui.chat.space, ui.chat.channel) : [])
  let title = $derived(isDm ? partner?.name || 'Warte auf deinen Freund…' : channel?.name || '')

  let scroller: HTMLDivElement | undefined = $state()
  let input: HTMLTextAreaElement | undefined = $state()
  let text = $state('')
  let pending = $state<{ id: number; name: string; ref: FileRef | null; progress: number; error?: string }[]>([])
  let replyTo = $state<Message | null>(null)
  let editing = $state<string | null>(null)
  let editText = $state('')
  let dragging = $state(0)
  let stick = true
  let lastKey = ''
  let sending = $state(false)
  let picker = $state<{ m: Message; x: number; y: number } | null>(null)

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

  // The chat shrinks when a call opens (or the window changes): stay at the newest message
  $effect(() => {
    if (!scroller) return
    const el = scroller
    const ro = new ResizeObserver(() => {
      if (stick) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
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

  // Upload handles are shared by every open chat (main window and pop-outs), so
  // they must not collide across component instances
  let nextUpload = Math.floor(Math.random() * 1e9)

  $effect(() => on('upload', ({ upload, done, total }: { upload: number; done: number; total: number }) => {
    const p = pending.find((x) => x.id === upload)
    if (p && !p.ref) p.progress = total ? done / total : 0
  }))

  async function upload (file: File) {
    if (!ui.chat) return
    const id = nextUpload++
    pending.push({ id, name: file.name || 'Bild.png', ref: null, progress: 0 })
    try {
      const path = bridge.pathForFile(file)
      let ref: FileRef
      if (path) {
        ref = await call('uploadFile', { id: ui.chat.space, path, name: file.name, mime: file.type || guessMime(file.name), upload: id })
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
      toast('Warte, bis alle Dateien vorbereitet sind.')
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
      const mine = [...messages].reverse().find((m) => m.author === ui.me && m.text && current(m))
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

  // ---- reactions ----

  const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥']
  const EMOJIS = [
    '👍', '👎', '❤️', '😂', '🤣', '😮', '😢', '😭', '😡', '🔥', '🎉', '💯',
    '😀', '😁', '😅', '😊', '😍', '🥰', '😘', '😎', '🤔', '🙄', '😬', '😴',
    '🤯', '🥲', '😇', '🤡', '💀', '👀', '🙏', '👏', '🙌', '💪', '🤝', '👋',
    '✅', '❌', '⭐', '✨', '💔', '💩', '🍺', '🍕', '🎮', '🏆', '🚀', '🤷'
  ]

  function mine (r: { who: string[] }) {
    return r.who.includes(ui.me)
  }

  function toggleReaction (m: Message, emoji: string) {
    if (!ui.chat) return
    const on = !m.reactions.some((r) => r.emoji === emoji && mine(r))
    call('react', { id: ui.chat.space, channel: m.channel, message: m.id, emoji, on }).catch((err) => toast(errorText(err), 'error'))
  }

  function reactionTitle (r: { emoji: string; who: string[] }) {
    return r.who.map((id) => (id === ui.me ? 'Du' : memberName(space, id))).join(', ') + ' – ' + r.emoji
  }

  function openPicker (e: MouseEvent, m: Message) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // 300 x 240 is the picker's size; keep it on screen
    const x = Math.max(8, Math.min(rect.right - 300, window.innerWidth - 308))
    const y = rect.bottom + 246 > window.innerHeight ? Math.max(8, rect.top - 246) : rect.bottom + 6
    picker = { m, x, y }
  }

  function pick (emoji: string) {
    if (picker) toggleReaction(picker.m, emoji)
    picker = null
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

  // Messages from before a key rotation are read-only history
  function current (m: Message) {
    return !m.base || m.base === space?.baseId
  }

  function messageMenu (e: MouseEvent, m: Message) {
    if (!space) return
    const target = e.target as HTMLElement
    // right-click on a name or avatar: the person, not the message
    if (target.closest('.author, .avatar')) return userMenu(e, m.author, space.id)
    const link = target.closest('a[data-href]') as HTMLAnchorElement | null
    const article = target.closest('article')
    const sel = window.getSelection()
    const selected = sel && !sel.isCollapsed && article && article.contains(sel.anchorNode) ? sel.toString() : ''
    const own = m.author === ui.me
    const editable = own && !!m.text && current(m)
    const removable = current(m) && (own || space.role >= ROLE_ADMIN)
    openMenu(e, [
      selected && { label: 'Auswahl kopieren', icon: 'copy', action: () => copy(selected) },
      link && { label: 'Link kopieren', icon: 'link', action: () => copy(link.dataset.href!, 'Link kopiert') },
      link && { label: 'Link öffnen', icon: 'external-link', action: () => (ui.dialog = { type: 'link', url: link.dataset.href }) },
      (selected || link) && { type: 'sep' },
      { label: 'Antworten', icon: 'reply', action: () => { replyTo = m; input?.focus() } },
      current(m) && { type: 'sub', label: 'Reagieren', icon: 'smile-plus', items: QUICK.map((emoji) => ({ label: emoji, action: () => toggleReaction(m, emoji), checked: m.reactions.some((r) => r.emoji === emoji && mine(r)) })) },
      editable && { label: 'Bearbeiten', icon: 'edit', action: () => startEdit(m) },
      m.text && { label: 'Text kopieren', icon: 'copy', action: () => copy(m.text) },
      m.text && { label: 'Zitieren', icon: 'chat', action: () => quote(m) },
      { type: 'sep' },
      { label: 'Zeitpunkt kopieren', action: () => copy(new Date(m.ts).toLocaleString('de-DE')) },
      { label: 'Nachrichten-ID kopieren', action: () => copy(m.id, 'ID kopiert') },
      removable && { type: 'sep' },
      removable && { label: 'Nachricht löschen', icon: 'trash', danger: true, action: () => remove(m) }
    ])
  }

  function quote (m: Message) {
    const lines = m.text.split('\n').map((l) => '> ' + l).join('\n')
    text = (text ? text + '\n' : '') + lines + '\n'
    tick().then(() => {
      autosize()
      input?.focus()
    })
  }

  function snippet (id: string | null) {
    if (!id) return null
    return messages.find((m) => m.id === id) || null
  }
</script>

<section
  class="chat"
  class:compact
  class:stacked
  ondragenter={(e) => { if (e.dataTransfer?.types.includes('Files')) dragging++ }}
  ondragleave={() => dragging = Math.max(0, dragging - 1)}
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
  role="region"
  aria-label="Chat"
>
  {#if space && channel}
    <header>
      {#if onback}
        <button class="icon-btn back" title="Zurück" onclick={onback}><Icon name="chevron-left" size={24} /></button>
      {:else if compact}
        <!-- next to a call the chat is the right panel: this button folds the chat itself -->
        <button class="icon-btn fold-side" title="Chat einklappen" onclick={() => { settings.callChat = false; saveSettings() }}>
          <Icon name="panel-right" size={18} />
        </button>
      {:else}
        <button class="icon-btn fold-side" title={settings.sidebarHidden ? 'Kanalliste einblenden' : 'Kanalliste ausblenden'} onclick={() => { settings.sidebarHidden = !settings.sidebarHidden; saveSettings() }}>
          <Icon name="panel-left" size={18} />
        </button>
      {/if}
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
        <button class="icon-btn" title="Freund entfernen" onclick={() => (ui.dialog = { type: 'leave', space: space!.id })}><Icon name="user-x" size={20} /></button>
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
        <article class="msg" class:compact-msg={settings.messageStyle === 'compact'} class:bubble={settings.messageStyle === 'bubbles'} class:grouped={settings.messageStyle !== 'compact' && grouped(messages, i)} class:mention={false} oncontextmenu={(e) => messageMenu(e, m)}>
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
          {#if settings.messageStyle === 'compact'}
            <span class="ctime" title={new Date(m.ts).toLocaleString('de-DE')}>{formatTime(m.ts)}</span>
            <span class="author" style="color:{nameColor(m.author)}">{memberName(space, m.author)}</span>
          {:else if grouped(messages, i)}
            <span class="gutter-time">{formatTime(m.ts)}</span>
          {:else}
            <div class="avatar"><Avatar id={m.author} name={memberName(space, m.author)} size={40} /></div>
            <div class="meta">
              <span class="author" style={settings.messageStyle === 'bubbles' ? `color:${nameColor(m.author)}` : ''}>{memberName(space, m.author)}</span>
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
              <Attachment space={space.id} base={m.base} file={f} />
            {/each}
            {#if m.reactions.length}
              <div class="reactions">
                {#each m.reactions as r (r.emoji)}
                  <button class="reaction" class:mine={mine(r)} title={reactionTitle(r)} disabled={!current(m)} onclick={() => toggleReaction(m, r.emoji)}>
                    <span class="remoji">{r.emoji}</span><span class="rcount">{r.who.length}</span>
                  </button>
                {/each}
                {#if current(m)}
                  <button class="reaction add" title="Reaktion hinzufügen" onclick={(e) => openPicker(e, m)}><Icon name="smile-plus" size={16} /></button>
                {/if}
              </div>
            {/if}
          </div>
          <div class="actions">
            {#if current(m)}
              {#each QUICK.slice(0, 3) as emoji}
                <button title="Mit {emoji} reagieren" class="quick" onclick={() => toggleReaction(m, emoji)}>{emoji}</button>
              {/each}
              <button title="Reaktion hinzufügen" onclick={(e) => openPicker(e, m)}><Icon name="smile-plus" size={18} /></button>
            {/if}
            <button title="Antworten" onclick={() => { replyTo = m; input?.focus() }}><Icon name="reply" size={18} /></button>
            {#if m.author === ui.me && m.text && current(m)}
              <button title="Bearbeiten" onclick={() => startEdit(m)}><Icon name="edit" size={18} /></button>
            {/if}
            {#if current(m) && (m.author === ui.me || space.role >= ROLE_ADMIN)}
              <button title="Löschen" class="danger" onclick={() => remove(m)}><Icon name="trash" size={18} /></button>
            {/if}
          </div>
        </article>
      {/each}
      <div class="bottom-pad"></div>
    </div>

    {#if picker}
      <div class="picker-backdrop" role="presentation" onclick={() => (picker = null)} oncontextmenu={(e) => { e.preventDefault(); picker = null }}></div>
      <div class="picker" style="left:{picker.x}px;top:{picker.y}px" role="dialog" aria-label="Emoji auswählen">
        {#each EMOJIS as emoji}
          <button class:mine={picker.m.reactions.some((r) => r.emoji === emoji && mine(r))} onclick={() => pick(emoji)}>{emoji}</button>
        {/each}
      </div>
    {/if}

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
              {#if !p.ref && p.progress > 0}
                <span class="upct" title="Wird für den Versand vorbereitet (verschlüsselt und bei dir gespeichert)">{Math.floor(p.progress * 100)} %</span>
                <span class="ubar" style="width:{p.progress * 100}%"></span>
              {/if}
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

<svelte:window onkeydown={(e) => { if (picker && e.key === 'Escape') picker = null }} />

<style>
  .chat {
    position: relative;
    flex: 1;
    min-width: 300px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-main);
  }
  .chat.compact {
    flex: 0 0 420px;
    width: 420px;
    border-left: 1px solid var(--border);
  }
  .chat.compact.stacked {
    flex: 0 0 42%;
    width: auto;
    min-width: 0;
    min-height: 200px;
    border-left: 0;
    border-top: 1px solid var(--border);
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
  .fold-side {
    margin-left: -8px;
    width: 28px;
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
    background: var(--bg-secondary);
    color: var(--text-strong);
  }
  .day {
    display: flex;
    align-items: center;
    margin: 16px 16px 8px;
    height: 0;
    border-top: 1px solid var(--divider);
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
    background: color-mix(in srgb, var(--text-muted) 7%, transparent);
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
    background: var(--bg-code);
    padding: 2px 4px;
    border-radius: 3px;
  }
  .text :global(pre) {
    background: var(--bg-code);
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
  .text :global(.quote) {
    display: block;
    border-left: 4px solid var(--text-faint);
    padding-left: 10px;
    color: var(--text-muted);
  }
  .text :global(.spoiler) {
    background: var(--bg-rail);
    color: transparent;
    border-radius: 3px;
    cursor: pointer;
  }
  .text :global(.spoiler.revealed) {
    color: inherit;
    background: var(--bg-hover);
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
    border-left: 2px solid var(--divider);
    border-top: 2px solid var(--divider);
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
    color: var(--red-text);
  }
  .actions .quick {
    font-size: 16px;
  }
  .reactions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .reaction {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 7px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: var(--bg-control);
    color: var(--text-muted);
    font-size: 13px;
  }
  .reaction:hover:not(:disabled) {
    border-color: var(--border-soft);
    background: var(--bg-control-hover);
  }
  .reaction.mine {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent-text);
  }
  .reaction:disabled {
    cursor: default;
  }
  .reaction.add {
    display: none;
    color: var(--text-muted);
  }
  .msg:hover .reaction.add {
    display: inline-flex;
  }
  .remoji {
    font-size: 16px;
    line-height: 1;
  }
  .rcount {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
  }
  .picker {
    position: fixed;
    z-index: 51;
    width: 300px;
    max-height: 240px;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    align-content: start;
    gap: 2px;
    padding: 8px;
    background: var(--bg-float);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .picker button {
    height: 34px;
    border-radius: 6px;
    font-size: 20px;
    line-height: 1;
  }
  .picker button:hover {
    background: var(--bg-hover);
  }
  .picker button.mine {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
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
  /* bubbles: TeamSpeak 6 style, every message in its own box under name and date */
  .msg.bubble {
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .msg.bubble:hover {
    background: none;
  }
  .bubble .author {
    font-weight: 600;
    font-size: 14px;
  }
  .bubble .text {
    display: inline-block;
    max-width: 100%;
    background: var(--bg-input);
    padding: 5px 10px;
    border-radius: 6px;
    margin-top: 2px;
  }
  .msg.bubble:hover .text {
    background: color-mix(in srgb, var(--bg-input) 85%, var(--text) 8%);
  }
  .bubble .text.jumbo {
    background: none;
    padding: 0;
  }
  .bubble .body :global(.card),
  .bubble .body :global(.media) {
    padding: 6px;
    background: var(--bg-input);
    border-radius: 6px;
  }

  /* compact: one line per message, like IRC or the TeamSpeak chat; wrapped lines hang under the text */
  .msg.compact-msg {
    margin-top: 0;
    min-height: 0;
    padding: 1px 48px 1px 16px;
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    column-gap: 6px;
    align-items: baseline;
  }
  .compact-msg .reply-ref {
    grid-column: 1 / -1;
  }
  .compact-msg .reply-line {
    display: none;
  }
  .compact-msg .ctime {
    font-size: 11px;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
  }
  .compact-msg .author {
    font-weight: 600;
    white-space: nowrap;
  }
  .compact-msg .author::after {
    content: ':';
    color: var(--text-muted);
  }
  .compact-msg .text.jumbo {
    font-size: 22px;
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
    background: var(--bg-sidebar);
    padding: 4px 8px 4px 16px;
    border-radius: 8px 8px 0 0;
    font-size: 13px;
    color: var(--text-muted);
  }
  .uploads {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    background: var(--bg-sidebar);
    padding: 10px 12px;
    border-radius: 8px 8px 0 0;
  }
  .replying + .uploads {
    border-radius: 0;
  }
  .upload {
    position: relative;
    overflow: hidden;
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
  .upct {
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .ubar {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--accent);
    transition: width 0.2s linear;
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
    color: var(--on-accent);
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
