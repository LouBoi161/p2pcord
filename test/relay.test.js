const test = require('brittle')
const net = require('net')
const nodeCrypto = require('crypto')
const b4a = require('b4a')
const NoiseSecretStream = require('@hyperswarm/secret-stream')
const { Duplex } = require('streamx')

const Relay = require('../workers/relay')
const { parseStun, encodeStun } = Relay

const MAGIC = 0x2112a442

// Two Hyperswarm-style encrypted connections joined back to back
function connPair () {
  let a = null
  let b = null
  const left = new Duplex({ write (data, cb) { b.push(data); cb() } })
  const right = new Duplex({ write (data, cb) { a.push(data); cb() } })
  a = left
  b = right
  return [new NoiseSecretStream(true, left), new NoiseSecretStream(false, right)]
}

// A minimal TURN client, as WebRTC would talk to the local relay
class Client {
  constructor (info) {
    this.info = info
    this.port = Number(info.urls.match(/:(\d+)\?/)[1])
    this.buffered = b4a.alloc(0)
    this.waiting = []
    this.inbox = []
    this.key = null
  }

  async connect () {
    this.socket = net.connect(this.port, '127.0.0.1')
    await new Promise((resolve) => this.socket.once('connect', resolve))
    this.socket.on('data', (chunk) => {
      this.buffered = b4a.concat([this.buffered, chunk])
      while (this.buffered.byteLength >= 4) {
        const stun = this.buffered[0] < 0x40
        const size = stun ? 20 + this.buffered.readUInt16BE(2) : 4 + ((this.buffered.readUInt16BE(2) + 3) & ~3)
        if (this.buffered.byteLength < size) break
        const frame = this.buffered.subarray(0, size)
        this.buffered = this.buffered.subarray(size)
        if (stun) {
          const msg = parseStun(frame)
          const w = this.waiting.findIndex((x) => b4a.equals(x.id, msg.id))
          if (w >= 0) this.waiting.splice(w, 1)[0].resolve(msg)
          else this.inbox.push({ kind: 'data', msg })
        } else {
          this.inbox.push({ kind: 'channel', channel: frame.readUInt16BE(0), data: frame.subarray(4, 4 + frame.readUInt16BE(2)) })
        }
      }
    })
  }

  request (type, attrs, auth = true) {
    const id = nodeCrypto.randomBytes(12)
    const all = auth && this.key ? [[0x0006, b4a.from(this.info.username)], [0x0014, this.realm], [0x0015, this.nonce], ...attrs] : attrs
    this.socket.write(encodeStun(type, id, all, auth ? this.key : null))
    return new Promise((resolve) => this.waiting.push({ id, resolve }))
  }

  async allocate () {
    const challenge = await this.request(0x0003, [[0x0019, b4a.from([17, 0, 0, 0])]], false)
    this.realm = challenge.get(0x0014)
    this.nonce = challenge.get(0x0015)
    this.key = nodeCrypto.createHash('md5').update(`${this.info.username}:${b4a.toString(this.realm)}:${this.info.credential}`).digest()
    const res = await this.request(0x0003, [[0x0019, b4a.from([17, 0, 0, 0])]])
    const relayed = res.get(0x0016)
    return { type: res.type, relayed: relayed && readXor(relayed) }
  }

  send (ip, port, data) {
    this.socket.write(encodeStun(0x0016, nodeCrypto.randomBytes(12), [[0x0012, xor(ip, port)], [0x0013, data]]))
  }

  channel (num, data) {
    const out = b4a.alloc(4 + ((data.byteLength + 3) & ~3))
    out.writeUInt16BE(num, 0)
    out.writeUInt16BE(data.byteLength, 2)
    out.set(data, 4)
    this.socket.write(out)
  }

  async next () {
    for (let i = 0; i < 100 && !this.inbox.length; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    return this.inbox.shift() || null
  }
}

function xor (ip, port) {
  const out = b4a.alloc(8)
  out[1] = 1
  out.writeUInt16BE(port ^ (MAGIC >>> 16), 2)
  const v = ip.split('.').reduce((n, p) => (n << 8) | Number(p), 0) >>> 0
  out.writeUInt32BE((v ^ MAGIC) >>> 0, 4)
  return out
}

function readXor (value) {
  const port = value.readUInt16BE(2) ^ (MAGIC >>> 16)
  const v = (value.readUInt32BE(4) ^ MAGIC) >>> 0
  return { ip: `${v >>> 24}.${(v >>> 16) & 255}.${(v >>> 8) & 255}.${v & 255}`, port }
}

test('relay: packets travel between two apps through their shared connection', async (t) => {
  const alice = new Relay({ ip: '10.1.1.1' })
  const bob = new Relay({ ip: '10.2.2.2' })
  await alice.listen()
  await bob.listen()
  t.teardown(() => { alice.close(); bob.close() })

  const [ca, cb] = connPair()
  await Promise.all([ca.opened, cb.opened]) // Hyperswarm hands out connections after the handshake
  alice.attach(ca)
  bob.attach(cb)
  t.teardown(() => { ca.destroy(); cb.destroy() })

  const a = new Client(alice.info())
  const b = new Client(bob.info())
  await a.connect()
  await b.connect()
  t.teardown(() => { a.socket.destroy(); b.socket.destroy() })

  // wrong password is refused
  const bad = new Client({ ...alice.info(), credential: 'falsch' })
  await bad.connect()
  const refused = await bad.allocate()
  t.is(refused.type, 0x0113, 'allocate with a wrong password fails (401)')
  bad.socket.destroy()

  const ra = await a.allocate()
  const rb = await b.allocate()
  t.is(ra.type, 0x0103, 'allocate succeeds')
  t.is(ra.relayed.ip, '10.1.1.1')
  t.is(rb.relayed.ip, '10.2.2.2')

  // wait until both sides announced their relayed address
  for (let i = 0; i < 100 && !(alice.byIp.has('10.2.2.2') && bob.byIp.has('10.1.1.1')); i++) await new Promise((resolve) => setTimeout(resolve, 20))

  // without a permission on bob's side, alice's packet is dropped
  const perm = await a.request(0x0008, [[0x0012, xor(rb.relayed.ip, rb.relayed.port)]])
  t.is(perm.type, 0x0108, 'alice may send to bob')
  a.send(rb.relayed.ip, rb.relayed.port, b4a.from('zu früh'))
  t.is(await b.next(), null, 'bob has no permission for alice yet')

  await b.request(0x0008, [[0x0012, xor(ra.relayed.ip, ra.relayed.port)]])
  a.send(rb.relayed.ip, rb.relayed.port, b4a.from('hallo bob'))
  const got = await b.next()
  t.is(got.kind, 'data')
  t.is(got.msg.type, 0x0017, 'bob gets a Data indication')
  t.is(b4a.toString(got.msg.get(0x0013)), 'hallo bob')
  t.alike(readXor(got.msg.get(0x0012)), ra.relayed, 'from alice\'s relayed address')

  // channels: bob binds one to alice and answers through it
  const bind = await b.request(0x0009, [[0x000c, b4a.from([0x40, 0x01, 0, 0])], [0x0012, xor(ra.relayed.ip, ra.relayed.port)]])
  t.is(bind.type, 0x0109, 'channel bind succeeds')
  b.channel(0x4001, b4a.from('hi alice!'))
  const back = await a.next()
  t.is(b4a.toString(back.msg.get(0x0013)), 'hi alice!', 'alice receives bob\'s channel data')

  a.send(rb.relayed.ip, rb.relayed.port, b4a.from('über kanal'))
  const viaChannel = await b.next()
  t.is(viaChannel.kind, 'channel')
  t.is(viaChannel.channel, 0x4001)
  t.is(b4a.toString(viaChannel.data), 'über kanal', 'bob receives on his bound channel')
})
