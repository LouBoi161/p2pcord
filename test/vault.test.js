const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const tmp = require('test-tmp')
const fs = require('fs')
const path = require('path')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const App = require('../workers/app')

function * files (dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield * files(full)
    else yield full
  }
}

function findOnDisk (dir, needle) {
  const hex = b4a.from(b4a.toString(needle, 'hex'))
  const hits = []
  for (const file of files(dir)) {
    const data = fs.readFileSync(file)
    if (data.includes(needle) || data.includes(hex)) hits.push(path.relative(dir, file))
  }
  return hits
}

test('vault: no identity secret or group key on disk in plain text', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const dir = await tmp(t)
  const vaultKey = crypto.randomBytes(32)

  const a = new App(dir, { bootstrap: testnet.bootstrap, vaultKey })
  await a.ready()
  await a.setName({ name: 'Louis' })
  const group = await a.createSpace({ name: 'Geheim' })
  const space = a.spaces.get(group.id)
  const groupKey = b4a.from(space.encryptionKey)
  const secret = b4a.from(a.identity.secretKey)
  const identity = (await a.init()).identity
  t.is((await a.init()).vault, 'keyring')
  await a.close()

  t.alike(findOnDisk(dir, secret.subarray(0, 32)), [], 'identity secret not stored in plain text')
  t.alike(findOnDisk(dir, groupKey), [], 'group encryption key not stored in plain text')

  // Same key: everything comes back
  const again = new App(dir, { bootstrap: testnet.bootstrap, vaultKey })
  await again.ready()
  const init = await again.init()
  t.is(init.identity, identity)
  t.is(init.name, 'Louis')
  await new Promise((resolve) => setTimeout(resolve, 500))
  t.ok(again.spaces.has(group.id), 'group reopened with sealed key')
  await again.close()

  // Wrong or missing key: refuse to start and never overwrite the identity
  const before = fs.readFileSync(path.join(dir, 'identity.json'))
  const wrong = new App(dir, { bootstrap: testnet.bootstrap, vaultKey: crypto.randomBytes(32) })
  await t.exception(wrong.ready(), /VAULT_LOCKED/)
  const none = new App(dir, { bootstrap: testnet.bootstrap })
  await t.exception(none.ready(), /VAULT_LOCKED/)
  t.alike(fs.readFileSync(path.join(dir, 'identity.json')), before, 'identity file untouched')
})

test('vault: migrates plain-text data from older versions', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const dir = await tmp(t)

  const old = new App(dir, { bootstrap: testnet.bootstrap })
  await old.ready()
  await old.setName({ name: 'Max' })
  const group = await old.createSpace({ name: 'Alt' })
  const groupKey = b4a.from(old.spaces.get(group.id).encryptionKey)
  const identity = (await old.init()).identity
  await old.close()
  t.ok(findOnDisk(dir, groupKey).length > 0, 'old version kept the key in plain text')

  const vaultKey = crypto.randomBytes(32)
  const upgraded = new App(dir, { bootstrap: testnet.bootstrap, vaultKey })
  await upgraded.ready()
  await new Promise((resolve) => setTimeout(resolve, 500))
  t.is((await upgraded.init()).identity, identity)
  t.ok(upgraded.spaces.has(group.id))
  await upgraded.close()

  t.alike(findOnDisk(dir, groupKey), [], 'no plain-text group key left after migration')
})
