// Update check against the GitHub releases. The AppImage updates itself: the
// new file is downloaded next to the running one, checked against SHA256SUMS
// (which must carry a valid signature by the release key below) and then
// renamed over the old file, so the next start runs the new version.
// Other installs (AUR package, zips on Windows/macOS/Linux) only get a notice.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { Readable, Transform } = require('stream')
const { pipeline } = require('stream/promises')

const REPO = 'LouBoi161/p2pcord'
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

// Ed25519 public key of the release signing key (SPKI, base64). The private
// key stays with the maintainer; see scripts/release-sums.mjs.
const RELEASE_KEY = 'MCowBQYDK2VwAyEAhyHnD5jX9tBvRtzYiwTN1SnF+PA7ZkzyrZ1yqY88d3Y='

const FIRST_CHECK = 15 * 1000
const CHECK_EVERY = 6 * 60 * 60 * 1000
const MAX_DOWNLOAD = 1024 * 1024 * 1024

function parseVersion (v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v))
  return m ? m.slice(1).map(Number) : null
}

function isNewer (candidate, current) {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

function parseSums (text) {
  const sums = new Map()
  for (const line of String(text).split('\n')) {
    const m = /^([0-9a-f]{64}) [ *](\S+)$/.exec(line.trim())
    if (m) sums.set(m[2], m[1])
  }
  return sums
}

function verifySums (text, signature, key = RELEASE_KEY) {
  try {
    const publicKey = crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.from(text), publicKey, Buffer.from(String(signature).trim(), 'base64'))
  } catch {
    return false
  }
}

const appImageName = (version) => `P2Pcord-${version}-x64.AppImage`

// auto: AppImage replaces itself; package: installed by pacman (AUR);
// manual: zip installs, the user downloads the new version
function installMode ({ platform, appImage, execPath }) {
  if (platform === 'linux' && appImage) return 'auto'
  if (platform === 'linux' && /^\/(opt|usr)\//.test(execPath)) return 'package'
  return 'manual'
}

function createUpdater ({ fetch, version, mode, appImage, key = RELEASE_KEY, onState }) {
  let state = { status: 'idle', mode, current: version }
  let busy = false
  let timers = []

  function set (patch) {
    state = { ...state, ...patch }
    onState(state)
  }

  async function getJson (url) {
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'P2Pcord/' + version } })
    if (res.status === 404) return null // no release yet
    if (!res.ok) throw new Error('GitHub antwortet mit ' + res.status)
    return res.json()
  }

  async function getText (url) {
    const res = await fetch(url, { headers: { 'User-Agent': 'P2Pcord/' + version } })
    if (!res.ok) throw new Error('Download fehlgeschlagen (' + res.status + ')')
    return res.text()
  }

  async function download (asset, expected) {
    const dir = path.dirname(appImage)
    const tmp = path.join(dir, '.' + path.basename(appImage) + '.update')
    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'P2Pcord/' + version } })
    if (!res.ok || !res.body) throw new Error('Download fehlgeschlagen (' + res.status + ')')
    const total = Number(res.headers.get('content-length')) || asset.size || 0
    if (total > MAX_DOWNLOAD) throw new Error('Update-Datei ist zu groß')

    const hash = crypto.createHash('sha256')
    let received = 0
    let lastReport = 0
    const meter = new Transform({
      transform (chunk, enc, cb) {
        received += chunk.length
        if (received > MAX_DOWNLOAD) return cb(new Error('Update-Datei ist zu groß'))
        hash.update(chunk)
        const now = Date.now()
        if (total && now - lastReport > 250) {
          lastReport = now
          set({ progress: received / total })
        }
        cb(null, chunk)
      }
    })

    try {
      await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(tmp, { mode: 0o755 }))
      if (hash.digest('hex') !== expected) throw new Error('Prüfsumme des Updates stimmt nicht')
      await fs.promises.chmod(tmp, 0o755)
      await fs.promises.rename(tmp, appImage)
    } catch (err) {
      await fs.promises.rm(tmp, { force: true })
      throw err
    }
  }

  async function check ({ manual = false } = {}) {
    if (busy || state.status === 'ready' || state.status === 'downloading') return state
    busy = true
    let found = false
    if (manual) set({ status: 'checking', error: null })
    try {
      const release = await getJson(RELEASE_API)
      const latest = release && String(release.tag_name).replace(/^v/, '')
      if (!release || !isNewer(latest, version)) {
        set({ status: 'current', latest: latest || version })
        return state
      }

      found = true
      const base = { latest, url: release.html_url || RELEASES_PAGE }
      const assets = new Map((release.assets || []).map((a) => [a.name, a]))
      const sumsAsset = assets.get('SHA256SUMS')
      const sigAsset = assets.get('SHA256SUMS.sig')
      const image = assets.get(appImageName(latest))
      // Only the AppImage installs itself, and only from a signed release;
      // everything else is offered as a manual download
      if (mode !== 'auto' || !sumsAsset || !sigAsset || !image) {
        set({ status: 'available', ...base })
        return state
      }

      const [sums, sig] = await Promise.all([getText(sumsAsset.browser_download_url), getText(sigAsset.browser_download_url)])
      if (!verifySums(sums, sig, key)) throw new Error('Signatur des Updates ist ungültig')
      const expected = parseSums(sums).get(appImageName(latest))
      if (!expected) throw new Error('Update fehlt in SHA256SUMS')

      set({ status: 'downloading', progress: 0, ...base })
      await download(image, expected)
      set({ status: 'ready', progress: 1 })
    } catch (err) {
      console.error('[updater]', err.message || err)
      // a failed background check (offline, rate limit) is not worth a banner
      set({ status: 'error', error: err.message || String(err), quiet: !manual && !found })
    } finally {
      busy = false
    }
    return state
  }

  function start () {
    timers.push(setTimeout(() => check(), FIRST_CHECK))
    timers.push(setInterval(() => check(), CHECK_EVERY))
  }

  function stop () {
    for (const t of timers) clearTimeout(t)
    timers = []
  }

  return { start, stop, check, get state () { return state } }
}

module.exports = { createUpdater, installMode, isNewer, parseSums, verifySums, appImageName, RELEASES_PAGE }
