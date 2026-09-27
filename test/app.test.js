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

async function until (fn, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const v = await fn()
    if (v) return v
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timeout')
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
  // Poll instead of waiting for events: they may already have fired
  await until(async () => (await a.getSpace({ id: group.id })).members.length === 2)
  await until(async () => (await b.getSpace({ id: group.id })).members.length === 2)
  await until(() => b._isMember(ia, group.id) && a._isMember(ib, group.id))
  a.setVoice({ space: group.id, channel: voice.id, muted: false, deaf: false })
  const peers = await until(() => {
    const p = b.presence.snapshot()
    return p[ia] && p[ia].voice ? p : null
  })
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
  await until(() => a2.spaces.has(group.id))
  const init = await a2.init()
  t.is(init.identity, ia)
  t.is(init.name, 'Louis')
  t.is(init.spaces.length, 1)
})

test('friends can be removed, also while the invite is still pending', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const dirA = await tmp(t)
  const { app: a } = createApp(t, testnet, dirA)
  const { app: b } = createApp(t, testnet, await tmp(t))
  await a.ready()
  await b.ready()

  // "Waiting for friend": nobody redeemed the code yet
  const waiting = await a.createSpace({ kind: 1 })
  await a.createInvite({ id: waiting.id })
  t.ok(await a.leaveSpace({ id: waiting.id }))
  t.absent(a.spaces.has(waiting.id))

  // An actual friend
  const dm = await a.createSpace({ kind: 1 })
  const code = await a.createInvite({ id: dm.id })
  await b.joinSpace({ code })
  await until(async () => (await b.getSpace({ id: dm.id })).members.length === 2)
  t.ok(await a.leaveSpace({ id: dm.id }))
  t.absent(a.spaces.has(dm.id))
  await until(async () => (await b.getSpace({ id: dm.id })).members.length === 1)

  // The friend can drop the now empty chat as well
  t.ok(await b.leaveSpace({ id: dm.id }))
  t.absent(b.spaces.has(dm.id))

  // Removed chats stay gone after a restart
  await a.close()
  const { app: a2 } = createApp(t, testnet, dirA)
  await a2.ready()
  t.is((await a2.init()).spaces.length, 0)
})

test('profile pictures reach friends, are verified and cached for offline', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const dirB = await tmp(t)
  const { app: a } = createApp(t, testnet, await tmp(t))
  const { app: b } = createApp(t, testnet, dirB)
  await a.ready()
  await b.ready()

  const png = crypto.randomBytes(2000).toString('base64') // content is not decoded by the backend
  const own = await a.setAvatar({ data: png, mime: 'image/png', color: '#ff8800' })
  t.ok(own.url.startsWith('data:image/png;base64,'))
  t.is(own.color, '#ff8800')
  await t.exception(a.setAvatar({ data: png, mime: 'text/html' }), /BAD_IMAGE/)
  await t.exception(a.setAvatar({ data: crypto.randomBytes(60 * 1024).toString('base64'), mime: 'image/png' }), /IMAGE_TOO_LARGE/)

  const ia = (await a.init()).identity
  const gotAvatar = waitFor(b, 'avatar', (d) => d.identity === ia && !!d.url)
  const dm = await a.createSpace({ kind: 1 })
  await b.joinSpace({ code: await a.createInvite({ id: dm.id }) })
  const got = await gotAvatar
  t.is(got.url, own.url)
  t.is(b.presence.snapshot()[ia].color, '#ff8800')

  // A picture that does not match the announced hash is ignored
  const events = []
  b.on('rpc-event', (e) => e.event === 'avatar' && events.push(e))
  b.presence._onmessage(ia, Buffer.from(JSON.stringify({ t: 'avatar', hash: b.presence.peers.get(ia).state.avatar, mime: 'image/png', data: crypto.randomBytes(100).toString('base64') })))
  t.is(events.length, 0)

  // b restarts while a is gone: the picture is still there
  await a.close()
  await b.close()
  const { app: b2 } = createApp(t, testnet, dirB)
  await b2.ready()
  t.is((await b2.init()).avatars[ia], own.url)

  // Removing the picture propagates as well
  const { app: a2 } = createApp(t, testnet, a.storage)
  await a2.ready()
  const removed = waitFor(b2, 'avatar', (d) => d.identity === ia && d.url === null)
  await a2.setAvatar({ data: null })
  await removed
  t.absent((await b2.init()).avatars[ia])
})
