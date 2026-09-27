// Serverless call relay. When WebRTC finds no direct path between two peers
// (both behind carrier-grade or symmetric NAT), their media can still travel
// through the Hyperswarm connection they already share.
//
// Each app runs a tiny TURN server (RFC 5766, TCP) on 127.0.0.1 that only its
// own UI uses. The "relayed address" it hands out is a made-up IPv4 address
// that stands for this device; peers learn it over the 'p2pcord/relay/v1'
// channel. A packet the local WebRTC sends to a peer's relayed address goes
// through Hyperswarm to that peer's app, whose TURN server hands it to its
// WebRTC as if it came from a real relay. Media stays DTLS-SRTP encrypted end
// to end; WebRTC only picks this path when nothing direct works.
const net = require('net')
const nodeCrypto = require('crypto')
const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const crypto = require('hypercore-crypto')

const PROTOCOL = 'p2pcord/relay/v1'
const MAGIC = 0x2112a442
const REALM = 'p2pcord'
const LIFETIME = 600 // seconds
const MAX_PACKET = 65535

// STUN message types (method | class bits); all methods used here are < 0x10
const BINDING = 0x0001
const ALLOCATE = 0x0003
const REFRESH = 0x0004
const SEND = 0x0006
const DATA = 0x0007
const CREATE_PERMISSION = 0x0008
const CHANNEL_BIND = 0x0009
const INDICATION = 0x0010
const SUCCESS = 0x0100
const ERROR = 0x0110

// Attributes
const A = {
  MAPPED_ADDRESS: 0x0001,
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  CHANNEL_NUMBER: 0x000c,
  LIFETIME: 0x000d,
  XOR_PEER_ADDRESS: 0x0012,
  DATA: 0x0013,
  REALM: 0x0014,
  NONCE: 0x0015,
  XOR_RELAYED_ADDRESS: 0x0016,
  REQUESTED_TRANSPORT: 0x0019,
  XOR_MAPPED_ADDRESS: 0x0020,
  FINGERPRINT: 0x8028
}

class Relay {
  /**
   * @param {object} [opts]
   * @param {string} [opts.ip] this device's relayed IPv4 address (random by default)
   */
  constructor ({ ip } = {}) {
    const r = crypto.randomBytes(3)
    this.ip = ip || `10.${r[0]}.${r[1]}.${r[2] || 1}`
    this.username = b4a.toString(crypto.randomBytes(8), 'hex')
    this.password = b4a.toString(crypto.randomBytes(16), 'hex')
    this.key = nodeCrypto.createHash('md5').update(`${this.username}:${REALM}:${this.password}`).digest()
    this.nonce = b4a.toString(crypto.randomBytes(8), 'hex')
    this.server = null
    this.port = 0
    this.allocations = new Map() // relayed port -> Allocation
    this.sockets = new Set() // TURN clients (the local WebRTC)
    this.nextPort = 20000 + (crypto.randomBytes(2).readUInt16BE(0) % 30000)
    this.peers = new Map() // identityHex -> { ip, links: Set }
    this.byIp = new Map() // relayed ip -> identityHex
  }

  async listen () {
    this.server = net.createServer((socket) => this._onClient(socket))
    this.server.on('error', () => {})
    await new Promise((resolve, reject) => {
      this.server.once('listening', resolve)
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1')
    })
    this.port = this.server.address().port
  }

  // What the UI adds to RTCPeerConnection's iceServers
  info () {
    if (!this.port) return null
    return { urls: `turn:127.0.0.1:${this.port}?transport=tcp`, username: this.username, credential: this.password }
  }

  close () {
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    for (const a of this.allocations.values()) clearTimeout(a.timer)
    this.allocations.clear()
    if (this.server) this.server.close()
    this.server = null
  }

  // ---- Hyperswarm side ----

  attach (conn) {
    const identity = b4a.toString(conn.remotePublicKey, 'hex')
    const mux = Protomux.from(conn)
    const channel = mux.createChannel({
      protocol: PROTOCOL,
      onopen: () => hello.send(b4a.from(JSON.stringify({ ip: this.ip }))),
      onclose: () => {
        const peer = this.peers.get(identity)
        if (!peer) return
        peer.links.delete(link)
        if (peer.links.size === 0) {
          this.peers.delete(identity)
          if (this.byIp.get(peer.ip) === identity) this.byIp.delete(peer.ip)
        }
      }
    })
    if (!channel) return

    const hello = channel.addMessage({
      encoding: c.raw,
      onmessage: (buf) => this._onHello(identity, link, buf)
    })
    const packet = channel.addMessage({
      encoding: c.raw,
      onmessage: (buf) => this._onPacket(identity, buf)
    })
    const link = { send: (buf) => packet.send(buf) }
    channel.open()
  }

  _onHello (identity, link, buf) {
    let msg
    try {
      msg = JSON.parse(b4a.toString(buf))
    } catch {
      return
    }
    if (!msg || typeof msg.ip !== 'string' || !isPrivateIp(msg.ip) || msg.ip === this.ip) return
    let peer = this.peers.get(identity)
    if (!peer) this.peers.set(identity, (peer = { ip: msg.ip, links: new Set() }))
    if (peer.ip !== msg.ip && this.byIp.get(peer.ip) === identity) this.byIp.delete(peer.ip)
    peer.ip = msg.ip
    peer.links.add(link)
    this.byIp.set(msg.ip, identity)
  }

  // frame: [dst port u16][src port u16][payload]
  _onPacket (identity, buf) {
    if (buf.byteLength < 4) return
    const peer = this.peers.get(identity)
    if (!peer) return
    const alloc = this.allocations.get(buf.readUInt16BE(0))
    if (!alloc) return
    alloc.deliver(peer.ip, buf.readUInt16BE(2), buf.subarray(4))
  }

  _forward (fromPort, ip, port, data) {
    const identity = this.byIp.get(ip)
    const peer = identity && this.peers.get(identity)
    if (!peer) return
    const [link] = peer.links
    if (!link) return
    const frame = b4a.allocUnsafe(4 + data.byteLength)
    frame.writeUInt16BE(port, 0)
    frame.writeUInt16BE(fromPort, 2)
    frame.set(data, 4)
    try {
      link.send(frame)
    } catch {}
  }

  // ---- TURN side ----

  _onClient (socket) {
    if (socket.setNoDelay) socket.setNoDelay(true)
    this.sockets.add(socket)
    let buffered = b4a.alloc(0)
    let alloc = null
    const client = {
      address: socket.remoteAddress || '127.0.0.1',
      port: socket.remotePort || 0,
      write: (buf) => {
        if (!socket.destroyed) socket.write(buf)
      },
      get allocation () {
        return alloc
      },
      set allocation (a) {
        alloc = a
      }
    }
    socket.on('data', (chunk) => {
      buffered = buffered.byteLength ? b4a.concat([buffered, chunk]) : chunk
      while (buffered.byteLength >= 4) {
        const first = buffered[0]
        let size
        if (first < 0x40) size = 20 + buffered.readUInt16BE(2) // STUN
        else if (first < 0x80) size = 4 + pad4(buffered.readUInt16BE(2)) // ChannelData, padded over TCP
        else return socket.destroy()
        if (size > MAX_PACKET + 24) return socket.destroy()
        if (buffered.byteLength < size) break
        const frame = buffered.subarray(0, size)
        buffered = buffered.subarray(size)
        try {
          if (first < 0x40) this._onStun(client, frame)
          else if (alloc) alloc.fromChannel(frame)
        } catch {}
      }
    })
    const done = () => {
      this.sockets.delete(socket)
      if (alloc) this._free(alloc)
      alloc = null
    }
    socket.on('close', done)
    socket.on('error', done)
  }

  _free (alloc) {
    if (this.allocations.get(alloc.port) === alloc) this.allocations.delete(alloc.port)
    clearTimeout(alloc.timer)
  }

  _onStun (client, buf) {
    const msg = parseStun(buf)
    if (!msg) return
    const { type, id } = msg

    if (type === BINDING) {
      return client.write(encodeStun(BINDING | SUCCESS, id, [[A.XOR_MAPPED_ADDRESS, xorAddress(client.address, client.port, id)]]))
    }

    if (type === (SEND | INDICATION)) {
      const alloc = client.allocation
      const peer = msg.get(A.XOR_PEER_ADDRESS)
      const data = msg.get(A.DATA)
      if (!alloc || !peer || !data) return
      const addr = readXorAddress(peer, id)
      if (addr) alloc.send(addr.ip, addr.port, data)
      return
    }

    const method = type & 0x000f
    if ((type & ~0x000f) !== 0) return // only requests are answered

    // Long-term credentials: first a challenge, then HMAC-SHA1 over the message
    if (!msg.get(A.MESSAGE_INTEGRITY)) {
      return client.write(encodeStun(method | ERROR, id, [
        [A.ERROR_CODE, errorCode(401, 'Unauthorized')],
        [A.REALM, b4a.from(REALM)],
        [A.NONCE, b4a.from(this.nonce)]
      ]))
    }
    const user = msg.get(A.USERNAME)
    if (!user || b4a.toString(user) !== this.username || !checkIntegrity(buf, msg, this.key)) {
      return client.write(encodeStun(method | ERROR, id, [[A.ERROR_CODE, errorCode(401, 'Unauthorized')], [A.REALM, b4a.from(REALM)], [A.NONCE, b4a.from(this.nonce)]]))
    }
    const reply = (cls, attrs) => client.write(encodeStun(method | cls, id, attrs, this.key))
    const fail = (code, reason) => reply(ERROR, [[A.ERROR_CODE, errorCode(code, reason)]])

    if (method === ALLOCATE) {
      if (client.allocation) return fail(437, 'Allocation Mismatch')
      const transport = msg.get(A.REQUESTED_TRANSPORT)
      if (!transport || transport[0] !== 17) return fail(442, 'Unsupported Transport Protocol')
      const alloc = new Allocation(this, client, this._port())
      client.allocation = alloc
      this.allocations.set(alloc.port, alloc)
      alloc.refresh(LIFETIME)
      return reply(SUCCESS, [
        [A.XOR_RELAYED_ADDRESS, xorAddress(this.ip, alloc.port, id)],
        [A.XOR_MAPPED_ADDRESS, xorAddress(client.address, client.port, id)],
        [A.LIFETIME, u32(LIFETIME)]
      ])
    }

    const alloc = client.allocation
    if (!alloc) return fail(437, 'Allocation Mismatch')

    if (method === REFRESH) {
      const want = msg.get(A.LIFETIME)
      const lifetime = want ? Math.min(want.readUInt32BE(0), 3600) : LIFETIME
      if (lifetime === 0) {
        this._free(alloc)
        client.allocation = null
      } else {
        alloc.refresh(lifetime)
      }
      return reply(SUCCESS, [[A.LIFETIME, u32(lifetime)]])
    }

    if (method === CREATE_PERMISSION) {
      const peers = msg.all(A.XOR_PEER_ADDRESS).map((p) => readXorAddress(p, id)).filter(Boolean)
      if (!peers.length) return fail(400, 'Bad Request')
      for (const p of peers) alloc.permit(p.ip)
      return reply(SUCCESS, [])
    }

    if (method === CHANNEL_BIND) {
      const num = msg.get(A.CHANNEL_NUMBER)
      const peer = msg.get(A.XOR_PEER_ADDRESS)
      const addr = peer && readXorAddress(peer, id)
      if (!num || !addr) return fail(400, 'Bad Request')
      const channel = num.readUInt16BE(0)
      if (channel < 0x4000 || channel > 0x7fff || !alloc.bind(channel, addr.ip, addr.port)) return fail(400, 'Bad Request')
      alloc.permit(addr.ip)
      return reply(SUCCESS, [])
    }

    return fail(400, 'Bad Request')
  }

  _port () {
    for (let i = 0; i < 40000; i++) {
      const port = this.nextPort
      this.nextPort = this.nextPort >= 60000 ? 20000 : this.nextPort + 1
      if (!this.allocations.has(port)) return port
    }
    throw new Error('NO_PORTS')
  }
}

class Allocation {
  constructor (relay, client, port) {
    this.relay = relay
    this.client = client
    this.port = port
    this.permissions = new Set() // peer ips
    this.channels = new Map() // number -> { ip, port }
    this.byPeer = new Map() // 'ip:port' -> number
    this.timer = null
  }

  refresh (seconds) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.relay._free(this), seconds * 1000)
    if (this.timer.unref) this.timer.unref()
  }

  permit (ip) {
    this.permissions.add(ip)
  }

  bind (channel, ip, port) {
    const key = ip + ':' + port
    const bound = this.channels.get(channel)
    if (bound && (bound.ip !== ip || bound.port !== port)) return false
    const other = this.byPeer.get(key)
    if (other !== undefined && other !== channel) return false
    this.channels.set(channel, { ip, port })
    this.byPeer.set(key, channel)
    return true
  }

  send (ip, port, data) {
    if (!this.permissions.has(ip)) return
    this.relay._forward(this.port, ip, port, data)
  }

  fromChannel (frame) {
    const bound = this.channels.get(frame.readUInt16BE(0))
    if (!bound) return
    const len = frame.readUInt16BE(2)
    this.send(bound.ip, bound.port, frame.subarray(4, 4 + len))
  }

  // A packet from a peer's relayed address arrives for this allocation
  deliver (ip, port, data) {
    if (!this.permissions.has(ip)) return
    const channel = this.byPeer.get(ip + ':' + port)
    if (channel !== undefined) {
      const out = b4a.alloc(4 + pad4(data.byteLength))
      out.writeUInt16BE(channel, 0)
      out.writeUInt16BE(data.byteLength, 2)
      out.set(data, 4)
      this.client.write(out)
      return
    }
    this.client.write(encodeStun(DATA | INDICATION, crypto.randomBytes(12), [
      [A.XOR_PEER_ADDRESS, xorAddress(ip, port, null)],
      [A.DATA, data]
    ]))
  }
}

// ---- STUN codec ----

function parseStun (buf) {
  if (buf.byteLength < 20 || buf.readUInt32BE(4) !== MAGIC) return null
  const type = buf.readUInt16BE(0)
  const length = buf.readUInt16BE(2)
  if (20 + length > buf.byteLength) return null
  const id = buf.subarray(8, 20)
  const attrs = []
  let o = 20
  while (o + 4 <= 20 + length) {
    const t = buf.readUInt16BE(o)
    const len = buf.readUInt16BE(o + 2)
    if (o + 4 + len > 20 + length) return null
    attrs.push({ type: t, offset: o, value: buf.subarray(o + 4, o + 4 + len) })
    o += 4 + pad4(len)
  }
  return {
    type,
    id,
    attrs,
    get: (t) => attrs.find((a) => a.type === t)?.value || null,
    all: (t) => attrs.filter((a) => a.type === t).map((a) => a.value)
  }
}

function encodeStun (type, id, attrs, key = null) {
  const parts = []
  let length = 0
  for (const [t, value] of attrs) {
    const head = b4a.alloc(4)
    head.writeUInt16BE(t, 0)
    head.writeUInt16BE(value.byteLength, 2)
    const padded = b4a.alloc(pad4(value.byteLength))
    padded.set(value, 0)
    parts.push(head, padded)
    length += 4 + padded.byteLength
  }
  const header = b4a.alloc(20)
  header.writeUInt16BE(type, 0)
  header.writeUInt32BE(MAGIC, 4)
  header.set(id, 8)
  if (key) {
    // MESSAGE-INTEGRITY covers everything before it, with the length already counting it
    header.writeUInt16BE(length + 24, 2)
    const mac = nodeCrypto.createHmac('sha1', key).update(b4a.concat([header, ...parts])).digest()
    const head = b4a.alloc(4)
    head.writeUInt16BE(A.MESSAGE_INTEGRITY, 0)
    head.writeUInt16BE(20, 2)
    parts.push(head, mac)
    length += 24
  }
  header.writeUInt16BE(length, 2)
  return b4a.concat([header, ...parts])
}

function checkIntegrity (buf, msg, key) {
  const mi = msg.attrs.find((a) => a.type === A.MESSAGE_INTEGRITY)
  if (!mi || mi.value.byteLength !== 20) return false
  const covered = b4a.from(buf.subarray(0, mi.offset))
  covered.writeUInt16BE(mi.offset - 20 + 24, 2)
  const mac = nodeCrypto.createHmac('sha1', key).update(covered).digest()
  return b4a.equals(mac, mi.value)
}

function xorAddress (ip, port, id) {
  const out = b4a.alloc(8)
  out[1] = 0x01 // IPv4
  out.writeUInt16BE(port ^ (MAGIC >>> 16), 2)
  const parts = String(ip).split('.').map(Number)
  const v = parts.length === 4 && parts.every((n) => n >= 0 && n < 256) ? ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0 : 0x7f000001
  out.writeUInt32BE((v ^ MAGIC) >>> 0, 4)
  return out
}

function readXorAddress (value, id) {
  if (value.byteLength < 8 || value[1] !== 0x01) return null // IPv4 only
  const port = value.readUInt16BE(2) ^ (MAGIC >>> 16)
  const v = (value.readUInt32BE(4) ^ MAGIC) >>> 0
  return { ip: `${v >>> 24}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`, port }
}

function errorCode (code, reason) {
  const text = b4a.from(reason)
  const out = b4a.alloc(4 + text.byteLength)
  out[2] = Math.floor(code / 100)
  out[3] = code % 100
  out.set(text, 4)
  return out
}

function u32 (n) {
  const out = b4a.alloc(4)
  out.writeUInt32BE(n, 0)
  return out
}

function pad4 (n) {
  return (n + 3) & ~3
}

function isPrivateIp (ip) {
  return /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip) && ip.split('.').every((n) => Number(n) < 256)
}

module.exports = Relay
module.exports.parseStun = parseStun
module.exports.encodeStun = encodeStun
