const test = require('brittle')
const tmp = require('test-tmp')

const Notifier = require('../workers/notifier')

const ME = 'aa'.repeat(32)
const BOB = 'bb'.repeat(32)

function dm (ts, author = BOB) {
  return {
    id: 'dm1',
    kind: 1,
    name: '',
    members: [{ identity: ME, name: 'Ich' }, { identity: BOB, name: 'Bob' }],
    channels: [{ id: 'c1', kind: 0, name: 'chat', latest: { ts, author, rev: ts } }, { id: 'v1', kind: 1, name: 'Anruf', latest: null }]
  }
}

function group (ts, author = BOB) {
  return {
    id: 'g1',
    kind: 0,
    name: 'Freunde',
    members: [{ identity: ME, name: 'Ich' }, { identity: BOB, name: 'Bob' }],
    channels: [{ id: 'allg', kind: 0, name: 'allgemein', latest: { ts, author, rev: ts } }]
  }
}

function create (storage, voice = null) {
  const out = []
  const n = new Notifier({ storage, me: () => ME, myVoice: () => voice, emit: (d) => out.push(d) })
  return { n, out }
}

test('notifier: new messages from others, once, not muted, not while visible', async (t) => {
  const storage = await tmp(t)
  const { n, out } = create(storage)

  await n.onSpace(dm(100))
  t.is(out.length, 0, 'first sighting only sets the baseline')

  await n.onSpace(dm(200))
  t.is(out.length, 1)
  t.alike(out[0], { kind: 'message', tag: 'dm1:c1', title: 'Bob', body: 'Neue Nachricht', space: 'dm1', channel: 'c1' })

  await n.onSpace(dm(200))
  t.is(out.length, 1, 'the same message is not reported twice')

  await n.onSpace(dm(300, ME))
  t.is(out.length, 1, 'own messages stay quiet')

  await n.onSpace(group(10))
  await n.onSpace(group(20))
  t.is(out[1].title, 'Freunde · #allgemein')
  t.is(out[1].body, 'Bob: Neue Nachricht')

  await n.setPrefs({ muted: { g1: true } })
  await n.onSpace(group(30))
  t.is(out.length, 2, 'muted group stays quiet')

  await n.setPrefs({ muted: {}, visible: true })
  await n.onSpace(group(40))
  t.is(out.length, 2, 'the visible UI shows messages itself')

  await n.setPrefs({ visible: false, enabled: false })
  await n.onSpace(group(50))
  t.is(out.length, 2, 'switched off')
  n.close()
})

test('notifier: the first message of a new, empty chat is reported', async (t) => {
  const { n, out } = create(await tmp(t))
  const empty = dm(0)
  empty.channels[0].latest = null
  await n.onSpace(empty)
  await n.onSpace(dm(100))
  t.is(out.length, 1)
  n.close()
})

test('notifier: remembers what it has seen across restarts', async (t) => {
  const storage = await tmp(t)
  const a = create(storage)
  await a.n.onSpace(dm(100))
  a.n.close() // flushes

  // after a reboot a message that arrived meanwhile is reported
  const b = create(storage)
  await b.n.onSpace(dm(150))
  t.is(b.out.length, 1, 'message received while the phone was off')
  b.n.close()
})

test('notifier: a friend joining our DM call rings, leaving cancels', async (t) => {
  const storage = await tmp(t)
  const { n, out } = create(storage)
  // an older DM with the same friend, known first: must not confuse which call is cancelled
  await n.onSpace({ ...dm(100), id: 'dm0' })
  await n.onSpace(dm(100))

  n.onPeers({ [BOB]: { name: 'Bob', voice: { space: 'dm1', channel: 'v1' } } })
  t.is(out.length, 1)
  t.alike(out[0], { kind: 'call', tag: 'call:dm1', title: 'Bob', body: 'ruft dich an', space: 'dm1', channel: 'v1' })

  n.onPeers({ [BOB]: { name: 'Bob', voice: { space: 'dm1', channel: 'v1' } } })
  t.is(out.length, 1, 'rings once')

  n.onPeers({ [BOB]: { name: 'Bob', voice: null } })
  t.alike(out[1], { kind: 'cancel', tag: 'call:dm1' })

  const inCall = create(await tmp(t), { space: 'dm1', channel: 'v1' })
  await inCall.n.onSpace(dm(100))
  inCall.n.onPeers({ [BOB]: { name: 'Bob', voice: { space: 'dm1', channel: 'v1' } } })
  t.is(inCall.out.length, 0, 'no ringing while we are in a call ourselves')
  n.close()
  inCall.n.close()
})
