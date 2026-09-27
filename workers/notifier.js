// Phone notifications decided by the backend, so they keep coming while the UI
// is paused, swiped away or not started yet (after a reboot). It watches the
// same 'space' and 'peers' events the UI gets and emits 'notify' events that
// the Android shell turns into system notifications.
const fs = require('fs')
const path = require('path')

const KIND_DM = 1
const TEXT = 0
const SAVE_DELAY = 2000

class Notifier {
  /**
   * @param {object} opts
   * @param {string} opts.storage backend data directory
   * @param {() => string | null} opts.me own identity (hex) once the app is ready
   * @param {() => object | null} opts.myVoice own voice state (null: not in a call)
   * @param {(data: object) => void} opts.emit sends a notification to the shell
   */
  constructor ({ storage, me, myVoice, emit }) {
    this.file = path.join(storage, 'notify.json')
    this.me = me
    this.myVoice = myVoice
    this.emit = emit
    this.enabled = true
    this.muted = {} // space id or space:channel -> true (the UI's mute list)
    this.visible = false // the UI is on screen: it shows new messages itself
    this.seen = {} // space:channel -> newest message ts already handled
    this.spaces = new Map() // id -> last state
    this.ringing = new Map() // identity calling us in a DM -> its notification tag
    this._saveTimer = null
    this._loaded = this._load()
  }

  async _load () {
    try {
      const saved = JSON.parse(await fs.promises.readFile(this.file, 'utf8'))
      if (typeof saved.enabled === 'boolean') this.enabled = saved.enabled
      if (saved.muted && typeof saved.muted === 'object') this.muted = saved.muted
      if (saved.seen && typeof saved.seen === 'object') this.seen = saved.seen
    } catch {}
  }

  _save () {
    if (this._saveTimer) return
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      const data = JSON.stringify({ enabled: this.enabled, muted: this.muted, seen: this.seen })
      fs.promises.writeFile(this.file, data).catch(() => {})
    }, SAVE_DELAY)
  }

  async setPrefs ({ enabled, muted, visible } = {}) {
    await this._loaded
    if (typeof enabled === 'boolean') this.enabled = enabled
    if (muted && typeof muted === 'object') this.muted = muted
    if (typeof visible === 'boolean') this.visible = visible
    this._save()
    return true
  }

  async onSpace (state) {
    await this._loaded
    if (!state || !state.id) return
    this.spaces.set(state.id, state)
    const me = this.me()
    for (const ch of state.channels || []) {
      if (ch.kind !== TEXT) continue
      const key = state.id + ':' + ch.id
      if (!ch.latest) {
        // an empty chat: its very first message must count as new
        if (this.seen[key] === undefined) {
          this.seen[key] = 0
          this._save()
        }
        continue
      }
      const before = this.seen[key]
      if (before !== undefined && ch.latest.ts <= before) continue
      this.seen[key] = ch.latest.ts
      this._save()
      // The first sighting of a chat only sets the baseline: no flood of old messages
      if (before === undefined) continue
      if (!this.enabled || this.visible || !me || ch.latest.author === me) continue
      if (this.muted[state.id] || this.muted[key]) continue
      const who = memberName(state, ch.latest.author)
      const dm = state.kind === KIND_DM
      this.emit({
        kind: 'message',
        tag: key,
        title: dm ? who : `${state.name} · #${ch.name}`,
        body: dm ? 'Neue Nachricht' : `${who}: Neue Nachricht`,
        space: state.id,
        channel: ch.id
      })
    }
  }

  onRemoved (id) {
    this.spaces.delete(id)
  }

  // A friend who joins the voice channel of our DM is calling us
  onPeers (peers) {
    const calling = new Set()
    for (const [identity, peer] of Object.entries(peers || {})) {
      const v = peer && peer.voice
      const space = v && this.spaces.get(v.space)
      if (space && space.kind === KIND_DM) calling.add(identity)
    }
    for (const identity of calling) {
      if (this.ringing.has(identity)) continue
      const space = this.spaces.get(peers[identity].voice.space)
      this.ringing.set(identity, 'call:' + space.id)
      if (!this.enabled || this.visible || this.myVoice() || this.muted[space.id]) continue
      this.emit({
        kind: 'call',
        tag: 'call:' + space.id,
        title: memberName(space, identity),
        body: 'ruft dich an',
        space: space.id,
        channel: peers[identity].voice.channel
      })
    }
    for (const [identity, tag] of [...this.ringing]) {
      if (calling.has(identity)) continue
      this.ringing.delete(identity)
      this.emit({ kind: 'cancel', tag })
    }
  }

  close () {
    if (!this._saveTimer) return
    clearTimeout(this._saveTimer)
    this._saveTimer = null
    try {
      fs.writeFileSync(this.file, JSON.stringify({ enabled: this.enabled, muted: this.muted, seen: this.seen }))
    } catch {}
  }
}

function memberName (space, identity) {
  const m = (space.members || []).find((x) => x.identity === identity)
  return (m && m.name) || 'Jemand'
}

module.exports = Notifier
