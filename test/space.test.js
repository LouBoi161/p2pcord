const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const BlindPairing = require('blind-pairing')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
const tmp = require('test-tmp')

const Space = require('../workers/space')

async function createPeer (t, testnet, name) {
  const identity = crypto.keyPair()
  const store = new Corestore(await tmp(t))
  const swarm = new Hyperswarm({ bootstrap: testnet.bootstrap, keyPair: identity })
  swarm.on('connection', (conn) => store.replicate(conn))
  const pairing = new BlindPairing(swarm, { poll: 500 })
  t.teardown(async () => {
    await pairing.close()
    await swarm.destroy()
    await store.close()
  }, { order: 1 })
  return {
    name,
    identity,
    open (opts) {
      const space = new Space({ store: store.namespace(crypto.randomBytes(8).toString('hex')), swarm, pairing, identity, profileName: name, ...opts })
      t.teardown(() => space.close(), { order: 0 })
      return space
    }
  }
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

test('create group, invite two peers, exchange messages', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const alice = await createPeer(t, testnet, 'Alice')
  const bob = await createPeer(t, testnet, 'Bob')
  const carol = await createPeer(t, testnet, 'Carol')

  const a = alice.open({ create: { name: 'Freunde', kind: Space.KIND_GROUP } })
  await a.ready()

  const state = await a.getState()
  t.is(state.name, 'Freunde')
  t.is(state.role, Space.ROLE_OWNER)
  t.is(state.channels.length, 2)
  const text = state.channels.find((c) => c.kind === Space.CHANNEL_TEXT)

  const code = await a.createInvite({ maxUses: 0 })
  t.ok(typeof code === 'string' && code.length > 20)

  const b = bob.open({ invite: code })
  await b.ready()
  const c = carol.open({ invite: code })
  await c.ready()

  t.alike(b.key, a.key, 'bob joined the same base')

  await a.sendMessage(text.id, 'hallo von alice')
  await b.sendMessage(text.id, 'hi, bob hier')
  await c.sendMessage(text.id, 'carol auch')

  for (const s of [a, b, c]) {
    const msgs = await until(async () => {
      await s.base.update()
      const m = await s.listMessages(text.id)
      return m.length === 3 ? m : null
    })
    t.alike(msgs.map((m) => m.text).sort(), ['carol auch', 'hallo von alice', 'hi, bob hier'])
  }

  const bState = await until(async () => {
    const s = await b.getState()
    return s.members.length === 3 ? s : null
  })
  t.is(bState.role, Space.ROLE_MEMBER)
  const bobMember = bState.members.find((m) => m.identity === b4a.toString(bob.identity.publicKey, 'hex'))
  t.is(bobMember.name, 'Bob')
})

test('members cannot create channels, owner can kick', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const alice = await createPeer(t, testnet, 'Alice')
  const bob = await createPeer(t, testnet, 'Bob')

  const a = alice.open({ create: { name: 'Gruppe', kind: Space.KIND_GROUP } })
  await a.ready()
  const b = bob.open({ invite: await a.createInvite() })
  await b.ready()

  await b.addChannel('bob-channel', Space.CHANNEL_TEXT)
  await new Promise((resolve) => setTimeout(resolve, 1000))
  await a.base.update()
  const s1 = await a.getState()
  t.absent(s1.channels.find((c) => c.name === 'bob-channel'), 'member channel creation rejected')

  await a.kick(b4a.toString(bob.identity.publicKey, 'hex'))
  const s2 = await a.getState()
  t.is(s2.members.length, 1, 'bob was removed')
})

test('dm allows only two identities', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const alice = await createPeer(t, testnet, 'Alice')
  const bob = await createPeer(t, testnet, 'Bob')
  const eve = await createPeer(t, testnet, 'Eve')

  const a = alice.open({ create: { name: '', kind: Space.KIND_DM } })
  await a.ready()
  const code = await a.createInvite({ maxUses: 0 })
  const b = bob.open({ invite: code })
  await b.ready()

  // Eve gets the (already used, single-use) code: she is rejected
  const e = eve.open({ invite: code })
  const joined = await Promise.race([
    e.ready().then(() => true, () => false),
    new Promise((resolve) => setTimeout(() => resolve(false), 4000))
  ])
  t.absent(joined, 'eve cannot join')
  const s = await a.getState()
  t.is(s.members.length, 2)
})

test('files: put on one peer, read on another', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const alice = await createPeer(t, testnet, 'Alice')
  const bob = await createPeer(t, testnet, 'Bob')

  const a = alice.open({ create: { name: 'Files', kind: Space.KIND_GROUP } })
  await a.ready()
  const b = bob.open({ invite: await a.createInvite() })
  await b.ready()

  const data = crypto.randomBytes(300 * 1024)
  const ref = await a.putFile(data, { name: 'bild.png', mime: 'image/png' })
  const text = (await a.getState()).channels.find((c) => c.kind === Space.CHANNEL_TEXT)
  await a.sendMessage(text.id, '', { files: [ref] })

  const msg = await until(async () => {
    await b.base.update()
    const m = await b.listMessages(text.id)
    return m[0]
  })
  t.is(msg.files[0].name, 'bild.png')
  const got = await b.readFile(msg.files[0])
  t.alike(got, data)
})

test('reactions: toggle, per person, cleared with the message; rev tracks every change', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const alice = await createPeer(t, testnet, 'Alice')
  const bob = await createPeer(t, testnet, 'Bob')

  const a = alice.open({ create: { name: 'Gruppe', kind: Space.KIND_GROUP } })
  await a.ready()
  const text = (await a.getState()).channels.find((c) => c.kind === Space.CHANNEL_TEXT)
  const b = bob.open({ invite: await a.createInvite() })
  await b.ready()

  const rev = async (s) => (await s.getState()).channels.find((c) => c.id === text.id).latest.rev
  const aliceHex = b4a.toString(alice.identity.publicKey, 'hex')
  const bobHex = b4a.toString(bob.identity.publicKey, 'hex')

  const first = await a.sendMessage(text.id, 'erste')
  const second = await a.sendMessage(text.id, 'zweite')
  const r0 = await rev(a)

  await a.react(text.id, first, '👍', true)
  await a.react(text.id, first, '👍', true) // twice counts once
  await until(async () => {
    await b.base.update()
    return (await b.listMessages(text.id)).length === 2
  })
  await b.react(text.id, first, '👍', true)
  await b.react(text.id, first, '🔥', true)

  const reacted = await until(async () => {
    await a.base.update()
    const m = (await a.listMessages(text.id)).find((x) => x.id === first)
    return m.reactions.length === 2 && m.reactions.find((r) => r.emoji === '👍').who.length === 2 ? m : null
  })
  t.alike(reacted.reactions.find((r) => r.emoji === '👍').who.sort(), [aliceHex, bobHex].sort())
  t.alike(reacted.reactions.find((r) => r.emoji === '🔥').who, [bobHex])
  t.ok((await rev(a)) > r0, 'reactions bump rev although no new message arrived')

  // Bob can only take back his own reaction
  await b.react(text.id, first, '👍', false)
  await until(async () => {
    await a.base.update()
    const m = (await a.listMessages(text.id)).find((x) => x.id === first)
    return m.reactions.find((r) => r.emoji === '👍').who.length === 1
  })
  t.alike((await a.listMessages(text.id)).find((x) => x.id === first).reactions.find((r) => r.emoji === '👍').who, [aliceHex])

  // Oversized or empty emoji strings and reactions to unknown messages are ignored
  await a.react(text.id, first, 'x'.repeat(100), true)
  await a.react(text.id, 'gibt-es-nicht', '👍', true)
  t.is((await a.listMessages(text.id)).find((x) => x.id === first).reactions.length, 2)

  // Editing and deleting bump rev too; deleting also drops the reactions
  const r1 = await rev(a)
  await a.editMessage(text.id, second, 'zweite, bearbeitet')
  const r2 = await rev(a)
  t.ok(r2 > r1, 'edit bumps rev')
  await a.deleteMessage(text.id, first)
  t.ok((await rev(a)) > r2, 'delete bumps rev')
  const left = await a.listMessages(text.id)
  t.alike(left.map((m) => m.text), ['zweite, bearbeitet'])
  t.is((await a.view.find('@p2pcord/reactions', {}).toArray()).length, 0, 'reactions of the deleted message are gone')
})
