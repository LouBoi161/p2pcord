// Ephemeral peer state over every Hyperswarm connection: who is online, who
// sits in which voice channel, and WebRTC signaling. Nothing here is persisted.
// Connections are Noise-authenticated with the peer's identity key, so
// conn.remotePublicKey is the peer's identity.
const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const EventEmitter = require('events')

const PROTOCOL = 'p2pcord/presence/v1'
const MAX_MESSAGE = 64 * 1024

class Presence extends EventEmitter {
  /**
   * @param {object} opts
   * @param {(identityHex: string, spaceId: string) => boolean} opts.isMember
   */
  constructor ({ isMember }) {
    super()
    this.isMember = isMember
    this.peers = new Map() // identityHex -> { conns: Set, state }
    this.name = ''
    this.voice = null // { space, channel, muted, deaf, video, screen }
  }

  attach (conn) {
    const identity = b4a.toString(conn.remotePublicKey, 'hex')
    const mux = Protomux.from(conn)
    const channel = mux.createChannel({
      protocol: PROTOCOL,
      onopen: () => {
        let peer = this.peers.get(identity)
        if (!peer) {
          peer = { conns: new Set(), state: { name: '', voice: null } }
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
        voice: voice && this.isMember(identity, voice.space) ? voice : null
      }
      this.emit('change')
      return
    }

    if (msg.t === 'signal') {
      if (typeof msg.space !== 'string' || !this.isMember(identity, msg.space)) return
      this.emit('signal', { from: identity, space: msg.space, data: msg.data })
    }
  }

  _stateFor (identity) {
    const voice = this.voice && this.isMember(identity, this.voice.space) ? this.voice : null
    return { t: 'state', name: this.name, voice }
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
