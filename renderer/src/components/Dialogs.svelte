<script lang="ts">
  import { untrack } from 'svelte'
  import Modal from './Modal.svelte'
  import Icon from './Icon.svelte'
  import Avatar from './Avatar.svelte'
  import Settings from './Settings.svelte'
  import { call, bridge, type ScreenSource } from '../lib/rpc'
  import {
    ui,
    toast,
    errorText,
    createGroup,
    createDmInvite,
    join,
    leave,
    isOnline,
    TEXT,
    VOICE,
    ROLE_ADMIN,
    ROLE_OWNER,
    KIND_DM
  } from '../lib/state.svelte'
  import { startScreen, leaveVoice, voice } from '../lib/voice/call.svelte'
  import { safetyNumber, fingerprint } from '../lib/format'

  let d = $derived(ui.dialog)
  let space = $derived(d?.space ? ui.spaces[d.space] : undefined)

  function close () {
    ui.dialog = null
  }

  // ---- create / join ----
  let tab = $state<'create' | 'join'>('create')
  let groupName = $state('')
  let code = $state('')
  let busy = $state(false)

  // Dialog setup runs once per opened dialog, not on every backend update
  function onOpen (type: string, fn: () => void) {
    $effect(() => {
      if (d?.type === type) untrack(fn)
    })
  }

  onOpen('create', () => {
    tab = d!.tab || 'create'
    groupName = ui.name ? `${ui.name}s Gruppe` : 'Meine Gruppe'
    code = ''
  })

  async function doCreate () {
    if (!groupName.trim()) return
    busy = true
    try {
      await createGroup(groupName.trim())
      close()
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      busy = false
    }
  }

  function doJoin () {
    const c = code.trim()
    if (!c) return
    close()
    join(c)
  }

  // ---- invites ----
  let invite = $state('')
  let inviteUses = $state('0')
  let inviteExpiry = $state('7')

  async function makeInvite () {
    if (!space) return
    busy = true
    invite = ''
    try {
      const days = +inviteExpiry
      invite = await call<string>('createInvite', {
        id: space.id,
        maxUses: +inviteUses,
        expiresIn: days ? days * 86400000 : 0
      })
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      busy = false
    }
  }

  onOpen('invite', () => {
    inviteUses = space?.kind === KIND_DM ? '1' : '0'
    inviteExpiry = '7'
    makeInvite()
  })

  // ---- add friend ----
  let friendCode = $state('')
  async function makeFriend () {
    busy = true
    friendCode = ''
    try {
      const res = await createDmInvite()
      friendCode = res.code
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      busy = false
    }
  }
  onOpen('friend', () => {
    friendCode = ''
    code = ''
  })

  function copy (text: string) {
    bridge.writeClipboard(text)
    toast('Kopiert!')
  }

  // ---- channel ----
  let channelName = $state('')
  let channelKind = $state(TEXT)
  onOpen('channel', () => {
    channelName = ''
    channelKind = d!.kind ?? TEXT
  })
  async function doChannel () {
    const name = channelName.trim().replace(/\s+/g, channelKind === TEXT ? '-' : ' ').toLowerCase()
    if (!name || !space) return
    await call('addChannel', { id: space.id, name: channelKind === TEXT ? name : channelName.trim(), kind: channelKind }).catch((err) => toast(errorText(err), 'error'))
    close()
  }

  // ---- rename ----
  let rename = $state('')
  onOpen('rename', () => {
    rename = space?.name || ''
  })
  async function doRename () {
    if (!space || !rename.trim()) return
    await call('renameSpace', { id: space.id, name: rename.trim() }).catch((err) => toast(errorText(err), 'error'))
    close()
  }

  // ---- screen picker ----
  let sources = $state<ScreenSource[] | null>(null)
  onOpen('screen', () => {
    sources = null
    bridge.screenSources().then(
      (list) => {
        // Wayland: the system portal already asked; one source means "use it"
        if (list.length <= 1) {
          close()
          startScreen(list[0]?.id || null)
        } else sources = list
      },
      (err) => {
        close()
        toast('Bildschirmliste nicht verfügbar: ' + errorText(err), 'error')
      }
    )
  })
  function pick (id: string) {
    close()
    startScreen(id)
  }

  // ---- verify ----
  let safety = $state('')
  onOpen('verify', () => {
    safety = ''
    safetyNumber(ui.me, d!.identity).then((s) => (safety = s))
  })

  // ---- members ----
  const roleName = (r: number) => (r === ROLE_OWNER ? 'Besitzer' : r === ROLE_ADMIN ? 'Admin' : 'Mitglied')

  async function doLeave () {
    if (!space) return
    const id = space.id
    close()
    if (voice.active?.space === id) await leaveVoice()
    await leave(id).catch((err) => toast(errorText(err), 'error'))
  }
</script>

{#if d?.type === 'create'}
  <Modal title={tab === 'create' ? 'Gruppe erstellen' : 'Einer Gruppe beitreten'} subtitle={tab === 'create' ? 'Deine Gruppe ist dein Ort für Text- und Sprachkanäle mit deinen Freunden.' : 'Gib einen Einladungscode ein, den du bekommen hast.'} onclose={close}>
    {#if tab === 'create'}
      <label class="field">
        <span>Gruppenname</span>
        <input class="input" bind:value={groupName} maxlength="32" onkeydown={(e) => e.key === 'Enter' && doCreate()} />
      </label>
      <p class="hint">Es gibt keinen Server: Die Gruppe liegt verschlüsselt nur auf den Geräten ihrer Mitglieder.</p>
    {:else}
      <label class="field">
        <span>Einladungscode</span>
        <textarea class="input codebox" bind:value={code} rows="3" placeholder="z. B. yry3m8kp…" onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), doJoin())}></textarea>
      </label>
      <p class="hint">Zum Beitreten muss mindestens ein Mitglied der Gruppe online sein. Das kann ein paar Sekunden dauern.</p>
    {/if}
    {#snippet footer()}
      {#if tab === 'create'}
        <button class="btn ghost" onclick={() => (tab = 'join')}>Hast du einen Code?</button>
        <span style="flex:1"></span>
        <button class="btn" onclick={doCreate} disabled={busy || !groupName.trim()}>{#if busy}<span class="spinner"></span>{/if} Erstellen</button>
      {:else}
        <button class="btn ghost" onclick={() => (tab = 'create')}>Zurück</button>
        <span style="flex:1"></span>
        <button class="btn" onclick={doJoin} disabled={!code.trim()}>Beitreten</button>
      {/if}
    {/snippet}
  </Modal>
{:else if d?.type === 'friend'}
  <Modal title="Freund hinzufügen" subtitle="Erstelle einen einmaligen Code und schick ihn deinem Freund – oder löse den Code deines Freundes ein." onclose={close} width={480}>
    <div class="label">Deinen Code erstellen</div>
    {#if friendCode}
      <div class="code-row">
        <div class="code">{friendCode}</div>
        <button class="btn" onclick={() => copy(friendCode)}><Icon name="copy" size={16} /> Kopieren</button>
      </div>
      <p class="hint">Gilt einmal und 7 Tage lang. Dein Freund gibt ihn unter „Code einlösen“ ein – du musst dafür online sein.</p>
    {:else}
      <button class="btn wide" onclick={makeFriend} disabled={busy}>{#if busy}<span class="spinner"></span>{/if}<Icon name="key" size={16} /> Freundescode erstellen</button>
    {/if}
    <div class="or"><span>oder</span></div>
    <label class="field">
      <span>Code deines Freundes einlösen</span>
      <div class="code-row">
        <input class="input" bind:value={code} placeholder="Code einfügen" onkeydown={(e) => e.key === 'Enter' && doJoin()} />
        <button class="btn" onclick={doJoin} disabled={!code.trim()}>Hinzufügen</button>
      </div>
    </label>
  </Modal>
{:else if d?.type === 'invite' && space}
  <Modal title={space.kind === KIND_DM ? 'Einladungscode' : `Freunde zu ${space.name} einladen`} onclose={close} width={500}>
    <div class="label">Einladungscode</div>
    <div class="code-row">
      <div class="code">{#if invite}{invite}{:else}<span class="spinner"></span>{/if}</div>
      <button class="btn" onclick={() => copy(invite)} disabled={!invite}><Icon name="copy" size={16} /> Kopieren</button>
    </div>
    {#if space.kind !== KIND_DM}
      <div class="row">
        <label class="field">
          <span>Läuft ab nach</span>
          <select class="input" bind:value={inviteExpiry} onchange={makeInvite}>
            <option value="1">1 Tag</option>
            <option value="7">7 Tagen</option>
            <option value="30">30 Tagen</option>
            <option value="0">Nie</option>
          </select>
        </label>
        <label class="field">
          <span>Maximale Nutzungen</span>
          <select class="input" bind:value={inviteUses} onchange={makeInvite}>
            <option value="1">1 Person</option>
            <option value="5">5 Personen</option>
            <option value="0">Unbegrenzt</option>
          </select>
        </label>
      </div>
    {/if}
    <p class="hint">Der Code enthält keine Schlüssel. Beim Beitreten prüft ein Mitglied, das gerade online ist, den Code und gibt die Gruppenschlüssel verschlüsselt weiter (Blind Pairing).</p>
  </Modal>
{:else if d?.type === 'channel' && space}
  <Modal title="Kanal erstellen" onclose={close}>
    <div class="label">Kanaltyp</div>
    <div class="kinds">
      <button class="kind" class:active={channelKind === TEXT} onclick={() => (channelKind = TEXT)}>
        <Icon name="hash" size={24} />
        <div><strong>Text</strong><span>Nachrichten, Bilder, Videos, Dateien</span></div>
      </button>
      <button class="kind" class:active={channelKind === VOICE} onclick={() => (channelKind = VOICE)}>
        <Icon name="volume" size={24} />
        <div><strong>Sprache</strong><span>Voice, Kamera und Bildschirm teilen</span></div>
      </button>
    </div>
    <label class="field">
      <span>Kanalname</span>
      <input class="input" bind:value={channelName} maxlength="32" placeholder={channelKind === TEXT ? 'neuer-kanal' : 'Neuer Kanal'} onkeydown={(e) => e.key === 'Enter' && doChannel()} />
    </label>
    {#snippet footer()}
      <button class="btn ghost" onclick={close}>Abbrechen</button>
      <button class="btn" onclick={doChannel} disabled={!channelName.trim()}>Kanal erstellen</button>
    {/snippet}
  </Modal>
{:else if d?.type === 'rename' && space}
  <Modal title="Gruppe umbenennen" onclose={close}>
    <label class="field">
      <span>Gruppenname</span>
      <input class="input" bind:value={rename} maxlength="32" onkeydown={(e) => e.key === 'Enter' && doRename()} />
    </label>
    {#snippet footer()}
      <button class="btn ghost" onclick={close}>Abbrechen</button>
      <button class="btn" onclick={doRename}>Speichern</button>
    {/snippet}
  </Modal>
{:else if d?.type === 'members' && space}
  <Modal title="Mitglieder" subtitle={`${space.members.length} ${space.members.length === 1 ? 'Mitglied' : 'Mitglieder'} in ${space.name}`} onclose={close} width={500}>
    <div class="members">
      {#each [...space.members].sort((a, b) => b.role - a.role || a.name.localeCompare(b.name)) as m (m.identity)}
        <div class="member">
          <Avatar id={m.identity} name={m.name} size={36} status={isOnline(m.identity) ? 'online' : 'offline'} />
          <div class="minfo">
            <span class="mname">{m.name}{m.identity === ui.me ? ' (du)' : ''}</span>
            <span class="mrole">
              {#if m.role === ROLE_OWNER}<Icon name="crown" size={12} />{:else if m.role === ROLE_ADMIN}<Icon name="shield" size={12} />{/if}
              {roleName(m.role)} · {fingerprint(m.identity).slice(0, 11)}
            </span>
          </div>
          {#if m.identity !== ui.me}
            <button class="icon-btn" title="Sicherheitsnummer" onclick={() => (ui.dialog = { type: 'verify', identity: m.identity, name: m.name })}><Icon name="shield-check" size={18} /></button>
          {/if}
          {#if space.role === ROLE_OWNER && m.role !== ROLE_OWNER}
            <button class="btn small secondary" onclick={() => call('setRole', { id: space.id, identity: m.identity, role: m.role === ROLE_ADMIN ? 0 : ROLE_ADMIN })}>
              {m.role === ROLE_ADMIN ? 'Admin entziehen' : 'Zum Admin'}
            </button>
          {/if}
          {#if space.role >= ROLE_ADMIN && m.role < space.role && m.identity !== ui.me}
            <button class="btn small danger" onclick={() => call('kick', { id: space.id, identity: m.identity })}>Entfernen</button>
          {/if}
        </div>
      {/each}
    </div>
  </Modal>
{:else if d?.type === 'leave' && space}
  <Modal title={`${space.name} verlassen`} onclose={close}>
    <p class="center">Willst du <strong>{space.name}</strong> wirklich verlassen? Du kannst nur mit einer neuen Einladung wieder beitreten.</p>
    {#snippet footer()}
      <button class="btn ghost" onclick={close}>Abbrechen</button>
      <button class="btn danger" onclick={doLeave}>Gruppe verlassen</button>
    {/snippet}
  </Modal>
{:else if d?.type === 'confirm'}
  <Modal title={d.title} onclose={close}>
    <p class="center">{d.text}</p>
    {#snippet footer()}
      <button class="btn ghost" onclick={close}>Abbrechen</button>
      <button class="btn" class:danger={d!.danger} onclick={() => { const run = d!.run; close(); run().catch((err: unknown) => toast(errorText(err), 'error')) }}>{d!.action}</button>
    {/snippet}
  </Modal>
{:else if d?.type === 'link'}
  <Modal title="Link öffnen?" subtitle="Dieser Link führt aus P2Pcord heraus. Öffne ihn nur, wenn du dem Absender vertraust." onclose={close} width={480}>
    <div class="code">{d.url}</div>
    {#snippet footer()}
      <button class="btn ghost" onclick={close}>Abbrechen</button>
      <button class="btn" onclick={() => { bridge.openExternal(d!.url); close() }}>Im Browser öffnen</button>
    {/snippet}
  </Modal>
{:else if d?.type === 'verify'}
  <Modal title="Sicherheitsnummer" subtitle={`Vergleiche diese Nummer mit ${d.name} – am besten persönlich oder in einem Anruf. Stimmt sie überein, redest du wirklich mit ${d.name}.`} onclose={close} width={460}>
    <div class="safety">{safety}</div>
    <p class="hint center">Jeder Account ist ein Schlüsselpaar auf dem Gerät. Die Nummer ergibt sich aus euren beiden öffentlichen Schlüsseln.</p>
  </Modal>
{:else if d?.type === 'screen'}
  <Modal title="Bildschirm teilen" subtitle="Wähle einen Bildschirm oder ein Fenster." onclose={close} width={720}>
    {#if !sources}
      <div class="center"><span class="spinner"></span></div>
    {:else}
      <div class="sources">
        {#each sources as s (s.id)}
          <button class="source" onclick={() => pick(s.id)}>
            {#if s.thumbnail}<img src={s.thumbnail} alt="" />{:else}<div class="thumb"><Icon name="monitor" size={32} /></div>{/if}
            <span>{s.name}</span>
          </button>
        {/each}
      </div>
    {/if}
  </Modal>
{:else if d?.type === 'image'}
  <div class="lightbox" role="presentation" onclick={close}>
    <img src={d.url} alt={d.name} />
  </div>
{:else if d?.type === 'settings'}
  <Settings tab={d.tab} onclose={close} />
{/if}

<style>
  .codebox {
    height: auto;
    padding: 10px;
    resize: none;
    font-family: var(--mono);
    font-size: 13px;
  }
  .code-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
    margin: 8px 0;
  }
  .code-row .code {
    flex: 1;
    min-height: 40px;
    display: flex;
    align-items: center;
  }
  .code-row .btn {
    height: auto;
    min-height: 40px;
  }
  .wide {
    width: 100%;
    margin: 8px 0 4px;
  }
  .or {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text-faint);
    font-size: 12px;
    margin: 18px 0;
    text-transform: uppercase;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-soft);
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-top: 12px;
  }
  .kinds {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 8px 0 20px;
  }
  .kind {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 4px;
    background: var(--bg-sidebar);
    text-align: left;
    color: var(--text-muted);
  }
  .kind div {
    display: flex;
    flex-direction: column;
  }
  .kind strong {
    color: var(--text);
  }
  .kind span {
    font-size: 13px;
  }
  .kind.active {
    background: var(--bg-active);
    outline: 2px solid var(--accent);
  }
  .members {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }
  .member {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px;
    border-radius: 6px;
  }
  .member:hover {
    background: var(--bg-hover);
  }
  .minfo {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .mname {
    font-weight: 600;
    color: var(--text-strong);
  }
  .mrole {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--mono);
  }
  .center {
    text-align: center;
    color: var(--text-muted);
    margin: 8px 0 16px;
  }
  .safety {
    font-family: var(--mono);
    font-size: 26px;
    letter-spacing: 0.04em;
    text-align: center;
    color: var(--text-strong);
    background: var(--bg-rail);
    padding: 20px;
    border-radius: 8px;
    margin: 8px 0 12px;
    word-spacing: 8px;
    user-select: text;
  }
  .sources {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }
  .source {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: 6px;
    background: var(--bg-sidebar);
    font-size: 13px;
    color: var(--text-muted);
    text-align: left;
  }
  .source:hover {
    outline: 2px solid var(--accent);
    color: var(--text);
  }
  .source img,
  .thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: contain;
    background: #000;
    border-radius: 4px;
    display: grid;
    place-items: center;
  }
  .source span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lightbox {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.85);
    display: grid;
    place-items: center;
    cursor: zoom-out;
  }
  .lightbox img {
    max-width: 92vw;
    max-height: 92vh;
    object-fit: contain;
  }
</style>
