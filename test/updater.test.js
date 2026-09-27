const test = require('brittle')
const tmp = require('test-tmp')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const { createUpdater, installMode, isNewer, parseSums, verifySums, appImageName } = require('../electron/updater')

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
const KEY = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const signed = (text, key = privateKey) => crypto.sign(null, Buffer.from(text), key).toString('base64')
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex')

// Minimal GitHub: /latest + asset downloads served from a map
function fakeGitHub (release, files) {
  const calls = []
  const fetch = async (url) => {
    calls.push(url)
    if (url.endsWith('/releases/latest')) {
      return release ? new Response(JSON.stringify(release)) : new Response('', { status: 404 })
    }
    const name = url.split('/').pop()
    if (!(name in files)) return new Response('', { status: 404 })
    return new Response(files[name], { headers: { 'content-length': String(Buffer.byteLength(files[name])) } })
  }
  return { fetch, calls }
}

function release (version, names) {
  return {
    tag_name: 'v' + version,
    html_url: 'https://example.invalid/release',
    assets: names.map((name) => ({ name, browser_download_url: 'https://dl.invalid/' + name, size: 0 }))
  }
}

async function setup (t, { version = '0.2.0', sums, sig, image = 'NEW APPIMAGE' } = {}) {
  const dir = await tmp(t)
  const appImage = path.join(dir, 'P2Pcord.AppImage')
  fs.writeFileSync(appImage, 'OLD APPIMAGE')
  sums = sums ?? `${sha(image)}  ${appImageName(version)}\n${sha('zip')}  P2Pcord-win32-x64-${version}.zip\n`
  sig = sig ?? signed(sums)
  const files = { SHA256SUMS: sums, 'SHA256SUMS.sig': sig, [appImageName(version)]: image }
  const gh = fakeGitHub(release(version, Object.keys(files)), files)
  const states = []
  const updater = createUpdater({ fetch: gh.fetch, version: '0.1.1', mode: 'auto', appImage, key: KEY, onState: (s) => states.push(s) })
  return { dir, appImage, updater, states, gh }
}

test('updater: versions compare numerically', (t) => {
  t.ok(isNewer('0.1.10', '0.1.9'))
  t.ok(isNewer('v1.0.0', '0.9.9'))
  t.absent(isNewer('0.1.1', '0.1.1'))
  t.absent(isNewer('0.1.0', '0.1.1'))
  t.absent(isNewer('0.2.0-beta', '0.1.1'))
  t.absent(isNewer('garbage', '0.1.1'))
})

test('updater: SHA256SUMS parsing and signature', (t) => {
  const text = `${'a'.repeat(64)}  P2Pcord-0.2.0-x64.AppImage\n${'b'.repeat(64)} *other.zip\nnoise\n`
  const sums = parseSums(text)
  t.is(sums.get('P2Pcord-0.2.0-x64.AppImage'), 'a'.repeat(64))
  t.is(sums.get('other.zip'), 'b'.repeat(64))
  t.is(sums.size, 2)

  t.ok(verifySums(text, signed(text), KEY))
  t.absent(verifySums(text + 'x', signed(text), KEY), 'modified sums')
  const other = crypto.generateKeyPairSync('ed25519').privateKey
  t.absent(verifySums(text, signed(text, other), KEY), 'foreign key')
  t.absent(verifySums(text, 'not base64 at all', KEY))
})

test('updater: install mode per platform', (t) => {
  t.is(installMode({ platform: 'linux', appImage: '/home/x/P2Pcord.AppImage', execPath: '/tmp/.mount_x/P2Pcord' }), 'auto')
  t.is(installMode({ platform: 'linux', execPath: '/opt/p2pcord/P2Pcord' }), 'package')
  t.is(installMode({ platform: 'linux', execPath: '/home/x/P2Pcord-linux-x64/P2Pcord' }), 'manual')
  t.is(installMode({ platform: 'win32', execPath: 'C:\\P2Pcord\\P2Pcord.exe' }), 'manual')
})

test('updater: AppImage is replaced by a verified download', async (t) => {
  const { appImage, updater, states } = await setup(t)
  const state = await updater.check()
  t.is(state.status, 'ready')
  t.is(state.latest, '0.2.0')
  t.is(fs.readFileSync(appImage, 'utf8'), 'NEW APPIMAGE')
  t.ok(fs.statSync(appImage).mode & 0o100, 'executable')
  t.ok(states.some((s) => s.status === 'downloading'))
  t.is(fs.readdirSync(path.dirname(appImage)).length, 1, 'no leftovers')
})

test('updater: bad signature leaves the AppImage alone', async (t) => {
  const other = crypto.generateKeyPairSync('ed25519').privateKey
  const sums = `${sha('EVIL')}  ${appImageName('0.2.0')}\n`
  const { appImage, updater } = await setup(t, { sums, sig: signed(sums, other), image: 'EVIL' })
  const state = await updater.check()
  t.is(state.status, 'error')
  t.absent(state.quiet, 'shown to the user')
  t.is(fs.readFileSync(appImage, 'utf8'), 'OLD APPIMAGE')
})

test('updater: checksum mismatch leaves the AppImage alone', async (t) => {
  const { appImage, updater } = await setup(t, { image: 'TAMPERED', sums: `${sha('NEW APPIMAGE')}  ${appImageName('0.2.0')}\n` })
  const state = await updater.check()
  t.is(state.status, 'error')
  t.is(fs.readFileSync(appImage, 'utf8'), 'OLD APPIMAGE')
  t.is(fs.readdirSync(path.dirname(appImage)).length, 1, 'partial download removed')
})

test('updater: signed sums for an older version are not accepted', async (t) => {
  // an old, validly signed SHA256SUMS served under a newer tag
  const sums = `${sha('OLD RELEASE')}  ${appImageName('0.1.0')}\n`
  const { appImage, updater } = await setup(t, { sums, image: 'OLD RELEASE' })
  const state = await updater.check()
  t.is(state.status, 'error')
  t.is(fs.readFileSync(appImage, 'utf8'), 'OLD APPIMAGE')
})

test('updater: up to date, unsigned release and non-AppImage installs', async (t) => {
  const current = fakeGitHub(release('0.1.1', []), {})
  const u1 = createUpdater({ fetch: current.fetch, version: '0.1.1', mode: 'auto', appImage: '/nonexistent', key: KEY, onState () {} })
  t.is((await u1.check()).status, 'current')

  const unsigned = fakeGitHub(release('0.2.0', [appImageName('0.2.0')]), {})
  const u2 = createUpdater({ fetch: unsigned.fetch, version: '0.1.1', mode: 'auto', appImage: '/nonexistent', key: KEY, onState () {} })
  const s2 = await u2.check()
  t.is(s2.status, 'available')
  t.is(s2.url, 'https://example.invalid/release')
  t.is(unsigned.calls.length, 1, 'nothing downloaded')

  const zip = fakeGitHub(release('0.2.0', ['SHA256SUMS', 'SHA256SUMS.sig', appImageName('0.2.0')]), {})
  const u3 = createUpdater({ fetch: zip.fetch, version: '0.1.1', mode: 'manual', key: KEY, onState () {} })
  t.is((await u3.check()).status, 'available')
  t.is(zip.calls.length, 1, 'nothing downloaded')

  const none = fakeGitHub(null, {})
  const u4 = createUpdater({ fetch: none.fetch, version: '0.1.1', mode: 'auto', key: KEY, onState () {} })
  t.is((await u4.check()).status, 'current')
})

test('updater: offline background check stays quiet', async (t) => {
  const fetch = async () => { throw new Error('offline') }
  const updater = createUpdater({ fetch, version: '0.1.1', mode: 'auto', key: KEY, onState () {} })
  const bg = await updater.check()
  t.is(bg.status, 'error')
  t.ok(bg.quiet)
  const manual = await updater.check({ manual: true })
  t.absent(manual.quiet)
})
