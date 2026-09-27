<script lang="ts">
  // Two cards with tiny mockups: Discord-like vs. TeamSpeak-like layout
  import { settings } from '../lib/settings.svelte'
  import { setLayout, type Layout } from '../lib/theme.svelte'

  let { onpick }: { onpick?: (l: Layout) => void } = $props()

  function pick (l: Layout) {
    setLayout(l)
    onpick?.(l)
  }
</script>

<div class="layouts">
  <button class="layout" class:active={settings.layout === 'discord'} onclick={() => pick('discord')}>
    <div class="mock discord">
      <div class="m-rail"><i></i><i></i><i></i></div>
      <div class="m-side"><b></b><b></b><b class="on"></b><b></b></div>
      <div class="m-main">
        <div class="m-msg"><span class="m-av"></span><span class="m-lines"><s></s><s class="short"></s></span></div>
        <div class="m-msg"><span class="m-av"></span><span class="m-lines"><s></s><s class="short"></s></span></div>
        <div class="m-input"></div>
      </div>
    </div>
    <strong>Wie Discord</strong>
    <span>Gruppenleiste, Kanalliste, große Nachrichten mit Profilbildern, Anruf neben dem Chat.</span>
  </button>
  <button class="layout" class:active={settings.layout === 'teamspeak'} onclick={() => pick('teamspeak')}>
    <div class="mock ts">
      <div class="m-nav"><b></b><b class="on"></b><b></b><b></b></div>
      <div class="m-side tree"><em></em><b class="card"></b><b class="sub"></b><b class="sub"></b><b class="card"></b></div>
      <div class="m-main">
        <div class="m-msg"><span class="m-av"></span><span class="m-lines"><s class="tiny"></s><s class="bubble"></s></span></div>
        <div class="m-msg"><span class="m-av"></span><span class="m-lines"><s class="tiny"></s><s class="bubble short"></s></span></div>
        <div class="m-input"></div>
      </div>
    </div>
    <strong>Wie TeamSpeak</strong>
    <span>Gruppen und Chats als Liste links, Kanäle als Karten mit den Leuten darin, Chat mit Sprechblasen.</span>
  </button>
</div>

<style>
  .layouts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .layout {
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: left;
    padding: 12px;
    border-radius: 8px;
    background: var(--bg-sidebar);
    color: var(--text-muted);
    font-size: 13px;
    outline: 2px solid transparent;
  }
  .layout:hover {
    background: var(--bg-active);
  }
  .layout.active {
    outline-color: var(--accent);
  }
  .layout strong {
    color: var(--text-strong);
    font-size: 15px;
  }
  .mock {
    height: 110px;
    border-radius: 6px;
    overflow: hidden;
    display: grid;
    grid-template-columns: 18px 58px 1fr;
    background: #1e1f22;
    margin-bottom: 4px;
  }
  .mock.ts {
    grid-template-columns: 44px 70px 1fr;
    background: #1b212b;
  }
  .m-nav {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px 5px;
  }
  .m-nav b {
    height: 5px;
    border-radius: 3px;
    background: #3a4454;
  }
  .m-nav b.on {
    background: #2176e8;
  }
  .m-side em {
    height: 14px;
    border-radius: 4px;
    background: #1e2530;
  }
  .m-side b.card {
    height: 9px;
    background: linear-gradient(90deg, #1e2530 50%, #274a7c);
  }
  s.tiny {
    width: 35%;
    height: 4px;
    background: #3fbf7f;
  }
  s.bubble {
    height: 9px;
    background: #1c222c;
  }
  .m-rail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 5px 3px;
  }
  .m-rail i {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #3a3c43;
  }
  .m-side {
    background: #2b2d31;
    padding: 6px 5px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ts .m-side {
    background: #262e3b;
  }
  .m-side b {
    height: 6px;
    border-radius: 3px;
    background: #4e5058;
  }
  .m-side b.sub {
    margin-left: 10px;
    background: #3a4454;
  }
  .m-side b.on {
    background: #5865f2;
  }
  .m-main {
    background: #313338;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ts .m-main {
    background: #232a35;
  }
  .ts .m-av {
    background: #3fbf7f;
  }
  .ts .m-input {
    background: #1c222c;
  }
  .m-msg {
    display: flex;
    gap: 5px;
  }
  .m-av {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #5865f2;
    flex: none;
  }
  .m-lines {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  s {
    display: block;
    height: 5px;
    border-radius: 3px;
    background: #4e5058;
  }
  s.short {
    width: 60%;
  }
  .m-input {
    margin-top: auto;
    height: 12px;
    border-radius: 4px;
    background: #383a40;
  }
</style>
