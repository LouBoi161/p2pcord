const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const tmp = require('test-tmp')
const fs = require('fs')
const path = require('path')
const crypto = require('hypercore-crypto')

const App = require('../workers/app')

function createApp (t, testnet, dir) {
  const events = []
  const app = new App(dir, {
    bootstrap: testnet.bootstrap,
    emit: (event, data) => {
      events.push({ event, data })
      app.emit('rpc-event', { event, data })
    }
  })
  t.teardown(() => app.close())
  return { app, events }
}

function waitFor (app, event, fn = () => true, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for ' + event)), timeout)
    app.on('rpc-event', function onevent (e) {
      if (e.event !== event || !fn(e.data)) return
      clearTimeout(timer)
      app.off('rpc-event', onevent)
      resolve(e.data)
    })
  })
}

test('two apps: join, presence, signaling, files, persistence', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const dirA = await tmp(t)
  const { app: a } = createApp(t, testnet, dirA)
  const { app: b } = createApp(t, testnet, await tmp(t))
  await a.ready()
  await b.ready()

  await a.setName({ name: 'Louis' })
  await b.setName({ name: 'Max' })

  const group = await a.createSpace({ name: 'Freunde' })
  const code = await a.createInvite({ id: group.id })
  const joined = await b.joinSpace({ code })
  t.is(joined.id, group.id)

  const ia = (await a.init()).identity
  const ib = (await b.init()).identity

  // Presence: b sees a in the voice channel once membership is known
  const voice = group.channels.find((c) => c.kind === 1)
  await waitFor(a, 'space', (s) => s.members.length === 2)
  await waitFor(b, 'space', (s) => s.members.length === 2).catch(() => {})
  a.setVoice({ space: group.id, channel: voice.id, muted: false, deaf: false })
  const peers = await waitFor(b, 'peers', (p) => p[ia] && p[ia].voice)
  t.is(peers[ia].voice.channel, voice.id)
  t.is(peers[ia].name, 'Louis')

  // Signaling reaches the other side
  const got = waitFor(a, 'signal')
  t.ok(b.signal({ to: ia, space: group.id, data: { type: 'offer', sdp: 'x' } }))
  const sig = await got
  t.is(sig.from, ib)
  t.alike(sig.data, { type: 'offer', sdp: 'x' })

  // Signals for a space the peer is not in are dropped
  t.absent(b.signal({ to: ia, space: 'f'.repeat(64), data: {} }))

  // Upload from disk on a, download into b's cache
  const src = path.join(dirA, 'video.mp4')
  const data = crypto.randomBytes(1024 * 1024 + 123)
  fs.writeFileSync(src, data)
  const ref = await a.uploadFile({ id: group.id, path: src, mime: 'video/mp4' })
  const text = group.channels.find((c) => c.kind === 0)
  await a.sendMessage({ id: group.id, channel: text.id, text: 'clip', files: [ref] })
  let msgs = []
  for (let i = 0; i < 100 && msgs.length === 0; i++) {
    msgs = await b.listMessages({ id: group.id, channel: text.id })
    if (!msgs.length) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const res = await b.fetchFile({ id: group.id, file: msgs[0].files[0] })
  t.alike(fs.readFileSync(path.join(b.storage, 'files', res.path)), data)

  // Restart a: identity and spaces survive
  await a.close()
  const { app: a2 } = createApp(t, testnet, dirA)
  await a2.ready()
  await waitFor(a2, 'space', (s) => s.id === group.id)
  const init = await a2.init()
  t.is(init.identity, ia)
  t.is(init.name, 'Louis')
  t.is(init.spaces.length, 1)
})
