// Ephemeral peer state over every Hyperswarm connection: who is online, who
// sits in which voice channel, and WebRTC signaling. Nothing here is persisted.
// Connections are Noise-authenticated with the peer's identity key, so
// conn.remotePublicKey is the peer's identity.
const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const crypto = require('hypercore-crypto')
const EventEmitter = require('events')

const PROTOCOL = 'p2pcord/presence/v1'
const MAX_MESSAGE = 64 * 1024
// Profile pictures travel as base64 in one presence message: a 256 px WebP is ~10-30 KB
const MAX_AVATAR = 48 * 1024
const AVATAR_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg'])
const HASH = /^[0-9a-f]{64}$/
const COLOR = /^#[0-9a-f]{6}$/i

class Presence extends EventEmitter {
  /**
   * @param {object} opts
   * @param {(identityHex: string, spaceId: string) => boolean} opts.isMember
   * @param {(identityHex: string, hash: string) => boolean} [opts.hasAvatar] whether a picture is cached already
   */
  constructor ({ isMember, hasAvatar = () => false }) {
    super()
    this.isMember = isMember
    this.hasAvatar = hasAvatar
    this.peers = new Map() // identityHex -> { conns: Set, state }
    this.name = ''
    this.voice = null // { space, channel, muted, deaf, video, screen }
    this.avatar = null // { hash, mime, data (base64) }
    this.color = ''
  }

  attach (conn) {
    const identity = b4a.toString(conn.remotePublicKey, 'hex')
    const mux = Protomux.from(conn)
    const channel = mux.createChannel({
      protocol: PROTOCOL,
      onopen: () => {
        let peer = this.peers.get(identity)
        if (!peer) {
          peer = { conns: new Set(), state: { name: '', voice: null, avatar: undefined, color: '' } }
          this.peers.set(identity, peer)
        }
        peer.conns.add(link)
        this._sendState(identity, link)
        this.emit('change')
      },
      onclose: () => {
        const peer = this.peers.get(identity)
        if (!peer) return
        peer.conns.delete(link)
        if (peer.conns.size === 0) {
          this.peers.delete(identity)
          this.emit('change')
        }
      }
    })
    if (!channel) return // already attached on this connection

    const message = channel.addMessage({
      encoding: c.raw,
      onmessage: (buf) => this._onmessage(identity, buf)
    })
    const link = {
      send: (obj) => message.send(b4a.from(JSON.stringify(obj)))
    }
    channel.open()
  }

  _onmessage (identity, buf) {
    if (buf.byteLength > MAX_MESSAGE) return
    let msg
    try {
      msg = JSON.parse(b4a.toString(buf))
    } catch {
      return
    }
    const peer = this.peers.get(identity)
    if (!peer || !msg || typeof msg !== 'object') return

    if (msg.t === 'state') {
      const voice = sanitizeVoice(msg.voice)
      peer.state = {
        name: typeof msg.name === 'string' ? msg.name.slice(0, 32) : '',
        // A peer can only claim to be in a voice channel of a space it belongs to
        voice: voice && this.isMember(identity, voice.space) ? voice : null,
        // undefined: an older version that knows nothing about pictures; null: no picture
        avatar: msg.avatar === null ? null : typeof msg.avatar === 'string' && HASH.test(msg.avatar) ? msg.avatar : undefined,
        color: typeof msg.color === 'string' && COLOR.test(msg.color) ? msg.color : ''
      }
      if (peer.state.avatar && !this.hasAvatar(identity, peer.state.avatar)) {
        const [link] = peer.conns
        try {
          link?.send({ t: 'avatar-get', hash: peer.state.avatar })
        } catch {}
      }
      this.emit('change')
      if (peer.state.avatar === null) this.emit('avatar', { identity, hash: null })
      return
    }

    if (msg.t === 'avatar-get') {
      if (!this.avatar || msg.hash !== this.avatar.hash) return
      const [link] = peer.conns
      try {
        link?.send({ t: 'avatar', hash: this.avatar.hash, mime: this.avatar.mime, data: this.avatar.data })
      } catch {}
      return
    }

    if (msg.t === 'avatar') {
      // only the picture the peer announced, and only if it really is that picture
      if (typeof msg.hash !== 'string' || msg.hash !== peer.state.avatar) return
      if (!AVATAR_TYPES.has(msg.mime) || typeof msg.data !== 'string' || msg.data.length > MAX_AVATAR * 1.4) return
      const bytes = b4a.from(msg.data, 'base64')
      if (bytes.byteLength > MAX_AVATAR || b4a.toString(crypto.hash(bytes), 'hex') !== msg.hash) return
      this.emit('avatar', { identity, hash: msg.hash, mime: msg.mime, data: msg.data })
      return
    }

    if (msg.t === 'signal') {
      if (typeof msg.space !== 'string' || !this.isMember(identity, msg.space)) return
      this.emit('signal', { from: identity, space: msg.space, data: msg.data })
    }
  }

  _stateFor (identity) {
    const voice = this.voice && this.isMember(identity, this.voice.space) ? this.voice : null
    return { t: 'state', name: this.name, voice, avatar: this.avatar ? this.avatar.hash : null, color: this.color }
  }

  _sendState (identity, link) {
    try {
      link.send(this._stateFor(identity))
    } catch {}
  }

  broadcast () {
    for (const [identity, peer] of this.peers) {
      for (const link of peer.conns) this._sendState(identity, link)
    }
  }

  setName (name) {
    this.name = name
    this.broadcast()
  }

  setAvatar (avatar, color) {
    this.avatar = avatar
    this.color = color || ''
    this.broadcast()
  }

  setVoice (voice) {
    this.voice = sanitizeVoice(voice)
    this.broadcast()
  }

  signal (to, space, data) {
    const peer = this.peers.get(to)
    if (!peer || !this.isMember(to, space)) return false
    const [link] = peer.conns
    if (!link) return false
    link.send({ t: 'signal', space, data })
    return true
  }

  snapshot () {
    const out = {}
    for (const [identity, peer] of this.peers) out[identity] = peer.state
    return out
  }
}

Presence.MAX_AVATAR = MAX_AVATAR
Presence.AVATAR_TYPES = AVATAR_TYPES

function sanitizeVoice (v) {
  if (!v || typeof v !== 'object') return null
  if (typeof v.space !== 'string' || typeof v.channel !== 'string') return null
  return {
    space: v.space.slice(0, 64),
    channel: v.channel.slice(0, 64),
    muted: !!v.muted,
    deaf: !!v.deaf,
    video: !!v.video,
    screen: !!v.screen
  }
}

module.exports = Presence
