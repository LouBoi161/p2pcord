<script lang="ts">
  import Icon from './Icon.svelte'
  import Logo from './Logo.svelte'
  import { setName, toast, errorText } from '../lib/state.svelte'

  let name = $state('')
  let busy = $state(false)

  async function go () {
    if (!name.trim()) return
    busy = true
    try {
      await setName(name.trim())
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      busy = false
    }
  }
</script>

<div class="onboarding">
  <div class="card">
    <div class="logo"><Logo size={72} /></div>
    <h1>Willkommen bei P2Pcord</h1>
    <p>Voice, Video und Chat mit deinen Freunden – ohne Server, ohne Account, Ende-zu-Ende verschlüsselt.</p>
    <label class="field">
      <span>Wie sollen dich deine Freunde sehen?</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" bind:value={name} maxlength="32" placeholder="Dein Name" autofocus onkeydown={(e) => e.key === 'Enter' && go()} />
    </label>
    <button class="btn" onclick={go} disabled={busy || !name.trim()}>{#if busy}<span class="spinner"></span>{/if} Los geht's</button>
    <ul>
      <li><Icon name="key" size={16} /> Dein Schlüssel wurde gerade auf diesem Gerät erzeugt.</li>
      <li><Icon name="lock" size={16} /> Nachrichten und Anrufe gehen direkt und verschlüsselt an deine Freunde.</li>
      <li><Icon name="sparkles" size={16} /> KI-Rauschunterdrückung läuft lokal auf deinem Gerät.</li>
    </ul>
  </div>
</div>

<style>
  .onboarding {
    flex: 1;
    display: grid;
    place-items: center;
    background:
      radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--accent) 35%, transparent), transparent 50%),
      radial-gradient(circle at 80% 80%, color-mix(in srgb, var(--green) 25%, transparent), transparent 50%),
      var(--bg-rail);
  }
  .card {
    width: 480px;
    max-width: calc(100vw - 32px);
    background: var(--bg-main);
    border-radius: 8px;
    padding: 32px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
  }
  .logo {
    display: grid;
    place-items: center;
    margin: 0 auto 16px;
  }
  h1 {
    text-align: center;
    color: var(--text-strong);
    font-size: 24px;
    margin: 0 0 8px;
  }
  p {
    text-align: center;
    color: var(--text-muted);
    margin: 0 0 24px;
  }
  .btn {
    height: 44px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 24px 0 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    color: var(--text-muted);
  }
  li {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  li :global(svg) {
    color: var(--green);
    flex: none;
  }
</style>
