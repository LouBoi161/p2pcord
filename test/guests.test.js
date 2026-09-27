const test = require('brittle')
const createTestnet = require('hyperdht/testnet')
const tmp = require('test-tmp')
const fs = require('fs')
const path = require('path')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const Guests = require('../workers/guests')
const { GUEST_METHODS } = require('../workers/rpc')

// A bridged guest as the desktop hosts it for an iPhone: events and answers
// come out of emit(), the account files go to the phone and back
function createHost (t, testnet, dir) {
  const out = []
  const guests = new Guests(dir, { methods: GUEST_METHODS, bootstrap: testnet.bootstrap, emit: (e) => out.push(e) })
  t.teardown(() => guests.closeAll())
  const rpc = async (slot, method, params) => {
    const id = Math.floor(Math.random() * 1e9)
    guests.guestRpc({ slot, id, method, params })
    for (let i = 0; i < 400; i++) {
      const e = out.find((x) => x.slot === slot && x.msg && x.msg.id === id)
      if (e) {
        if (e.msg.error) throw new Error(e.msg.error)
        return e.msg.result
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('timeout: ' + method)
  }
  return { guests, out, rpc }
}

function accountFrom (out, slot) {
  const account = {}
  for (const e of out) if (e.slot === slot && e.account) Object.assign(account, e.account)
  return account
}

test('guest account travels with the phone, sealed', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const vaultKey = b4a.toString(crypto.randomBytes(32), 'hex')
  const slot = 'ab'.repeat(16)

  // first bridge: a fresh account
  const dir1 = await tmp(t)
  const h1 = createHost(t, testnet, dir1)
  t.ok(await h1.guests.guestOpen({ slot, vaultKey, account: {} }))
  await h1.rpc(slot, 'setName', { name: 'iPhone' })
  const me = (await h1.rpc(slot, 'init', {})).identity
  const group = await h1.rpc(slot, 'createSpace', { name: 'Unterwegs' })

  const account = accountFrom(h1.out, slot)
  t.ok(account['identity.json'] && account['spaces.json'], 'identity and group list were sent to the phone')
  // what the phone keeps is sealed: the secret key is not in there
  const sealed = b4a.from(account['identity.json'], 'base64')
  t.is(b4a.toString(sealed.subarray(0, 5)), 'p2pv1', 'identity is sealed with the vault')
  t.absent(b4a.toString(sealed).includes('secretKey'))
  await h1.guests.guestClose({ slot })

  // a different bridge (other computer, empty storage) opens the same account
  const dir2 = await tmp(t)
  const h2 = createHost(t, testnet, dir2)
  await h2.guests.guestOpen({ slot, vaultKey, account })
  const init = await h2.rpc(slot, 'init', {})
  t.is(init.identity, me)
  t.is(init.name, 'iPhone')
  t.ok(init.spaces.some((s) => s.id === group.id) || init.loading > 0, 'group list came along')

  // without the phone's key the stored files are useless
  await h2.guests.guestClose({ slot })
  const h3 = createHost(t, testnet, dir2)
  await t.exception(h3.guests.guestOpen({ slot, vaultKey: 'cd'.repeat(32), account: {} }), /VAULT_LOCKED/)
})

test('guests cannot read files outside their own storage', async (t) => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const dir = await tmp(t)
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'host data')
  const h = createHost(t, testnet, dir)
  const slot = 'cd'.repeat(16)
  await h.guests.guestOpen({ slot, vaultKey: b4a.toString(crypto.randomBytes(32), 'hex'), account: {} })

  await t.exception(h.guests.guestFile({ slot, path: '../../secret.txt' }), /NOT_ALLOWED/)
  await t.exception(h.rpc(slot, 'uploadFile', { id: 'x', path: path.join(dir, 'secret.txt') }), /NOT_ALLOWED/)
  t.exception(() => h.guests.guestRpc({ slot: '../x', id: 1, method: 'init' }))
  await t.exception(h.guests.guestOpen({ slot: '../../evil', vaultKey: 'ab'.repeat(32) }), /BAD_SLOT/)

  // dropping a guest removes everything it stored
  t.ok(await h.guests.guestDrop({ slot }))
  t.absent(fs.existsSync(path.join(dir, 'guests', slot)))
})
