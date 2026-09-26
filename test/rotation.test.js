const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const tmp = require('test-tmp')
const b4a = require('b4a')

const App = require('../workers/app')

function createApp (t, testnet, dir) {
  const app = new App(dir, {
    bootstrap: testnet.bootstrap,
    emit: (event, data) => app.emit('rpc-event', { event, data })
  })
  t.teardown(() => app.close())
  return app
}

async function until (fn, timeout = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const v = await fn()
    if (v) return v
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('timeout')
}

test('kick rotates keys: remaining members move over, the kicked one is locked out', async (t) => {
  t.timeout(90000)
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const louis = createApp(t, testnet, await tmp(t))
  const max = createApp(t, testnet, await tmp(t))
  const eve = createApp(t, testnet, await tmp(t))
  for (const [app, name] of [[louis, 'Louis'], [max, 'Max'], [eve, 'Eve']]) {
    await app.ready()
    await app.setName({ name })
  }

  const group = await louis.createSpace({ name: 'Zockerrunde' })
  const text = group.channels.find((c) => c.kind === 0)
  await max.joinSpace({ code: await louis.createInvite({ id: group.id }) })
  await eve.joinSpace({ code: await louis.createInvite({ id: group.id }) })
  await louis.sendMessage({ id: group.id, channel: text.id, text: 'vor dem Kick' })
  await until(async () => (await eve.listMessages({ id: group.id, channel: text.id })).length === 1)

  const eveId = (await eve.init()).identity
  const oldBase = louis.spaces.get(group.id).baseId
  t.ok(await louis.kick({ id: group.id, identity: eveId }), 'louis rotated the keys')

  const newBase = louis.spaces.get(group.id).baseId
  t.not(newBase, oldBase, 'group now lives in a new base')
  t.is(louis.spaces.get(group.id).id, group.id, 'stable group id is unchanged')

  // Max moves over by himself, keeping his role and the channel ids
  await until(() => max.spaces.get(group.id)?.baseId === newBase)
  t.pass('max migrated automatically')
  const maxState = await max.getSpace({ id: group.id })
  t.is(maxState.channels.find((c) => c.kind === 0).id, text.id, 'channel ids kept')
  t.is(maxState.members.length, 2, 'eve is not in the new base')

  await max.sendMessage({ id: group.id, channel: text.id, text: 'nach dem Kick' })
  const seen = await until(async () => {
    const list = await louis.listMessages({ id: group.id, channel: text.id })
    return list.length === 2 ? list : null
  })
  t.alike(seen.map((m) => m.text), ['vor dem Kick', 'nach dem Kick'], 'history merged across bases')

  // Eve: removed, still on the old base, cannot open any sealed invite
  await until(async () => (await eve.getSpace({ id: group.id })).role === -1)
  const eveSpace = eve.spaces.get(group.id)
  t.is(eveSpace.baseId, oldBase, 'eve stays on the old base')
  t.is(await eveSpace.pendingRekey(), null, 'no rekey addressed to eve')
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const eveMsgs = await eve.listMessages({ id: group.id, channel: text.id })
  t.alike(eveMsgs.map((m) => m.text), ['vor dem Kick'], 'eve never sees messages after the kick')

  // Eve cannot use the successor's (restricted) invite either, even if it leaked:
  // the pairing member refuses identities that are not on the migrant list.
  const leaked = (await eveSpace.view.get('@p2pcord/rekeys', { to: b4a.from((await max.init()).identity, 'hex') })).box
  t.ok(leaked, 'eve can see the sealed box meant for max')
  const { openSealed } = require('../workers/seal')
  t.is(openSealed(eve.identity, leaked), null, 'but cannot open it')
})

test('rotation: leaked successor invite is refused, offline member migrates later, survives restart', async (t) => {
  t.timeout(120000)
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const maxDir = await tmp(t)
  const louis = createApp(t, testnet, await tmp(t))
  let max = createApp(t, testnet, maxDir)
  const eve = createApp(t, testnet, await tmp(t))
  for (const [app, name] of [[louis, 'Louis'], [max, 'Max'], [eve, 'Eve']]) {
    await app.ready()
    await app.setName({ name })
  }
  const group = await louis.createSpace({ name: 'Gruppe' })
  const text = group.channels.find((c) => c.kind === 0)
  await max.joinSpace({ code: await louis.createInvite({ id: group.id }) })
  await eve.joinSpace({ code: await louis.createInvite({ id: group.id }) })
  await until(async () => (await louis.getSpace({ id: group.id })).members.length === 3)
  const maxId = (await max.init()).identity
  const eveId = (await eve.init()).identity

  // Max goes offline, then Louis kicks Eve
  await max.close()
  await louis.kick({ id: group.id, identity: eveId })
  const newBase = louis.spaces.get(group.id).baseId
  await louis.sendMessage({ id: group.id, channel: text.id, text: 'nur für Max und Louis' })

  // Eve somehow got Max's invite in plain text: the pairing member refuses her
  const { openSealed } = require('../workers/seal')
  const oldSpace = louis.archives.get(group.id)[0]
  const box = (await oldSpace.view.get('@p2pcord/rekeys', { to: b4a.from(maxId, 'hex') })).box
  const leaked = b4a.toString(openSealed(max.identity, box))
  await eve.leaveSpace({ id: group.id }).catch(() => {})
  await t.exception(eve.joinSpace({ code: leaked }), /PAIRING_REJECTED|rejected/i, 'leaked invite refused')

  // Max comes back online: migrates, sees the new message
  max = createApp(t, testnet, maxDir)
  await max.ready()
  await until(() => max.spaces.get(group.id)?.baseId === newBase)
  const msgs = await until(async () => {
    const list = await max.listMessages({ id: group.id, channel: text.id })
    return list.some((m) => m.text === 'nur für Max und Louis') ? list : null
  })
  t.ok(msgs, 'offline member migrated and reads new messages')

  // Restart: the new base is current, the old one is history
  await max.close()
  max = createApp(t, testnet, maxDir)
  await max.ready()
  await until(() => max.spaces.get(group.id)?.baseId === newBase)
  const entry = max.registry.find((e) => e.id === group.id)
  t.is(entry.history.length, 1, 'old base kept as history')
})
