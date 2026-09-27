// Writes out/make/SHA256SUMS for the release files of the current version and
// signs it (SHA256SUMS.sig), so installed AppImages accept the update.
// Upload both files together with the release files.
//
//   node scripts/release-sums.mjs [extra files…]
//
// The Ed25519 signing key is read from $P2PCORD_SIGNING_KEY or
// ~/.config/p2pcord-release/signing-key.pem. Keep a backup of it: without the
// key, installed apps can no longer update themselves.
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { version } = require('../package.json')
const { verifySums } = require('../electron/updater.js')

const make = join(root, 'out', 'make')
const keyFile = process.env.P2PCORD_SIGNING_KEY || join(homedir(), '.config', 'p2pcord-release', 'signing-key.pem')

function * walk (dir) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield * walk(full)
    else yield full
  }
}

const wanted = new Set([
  `P2Pcord-${version}-x64.AppImage`,
  `P2Pcord-linux-x64-${version}.zip`,
  `P2Pcord-win32-x64-${version}.zip`,
  `P2Pcord-darwin-arm64-${version}.zip`,
  `P2Pcord-${version}-android-arm64-v8a.apk`,
  `P2Pcord-${version}-android-armeabi-v7a.apk`,
  `P2Pcord-${version}-android-x86_64.apk`
])
const files = [...walk(make)].filter((f) => wanted.has(basename(f)))
files.push(...process.argv.slice(2))

if (!files.some((f) => basename(f) === `P2Pcord-${version}-x64.AppImage`)) {
  console.error(`P2Pcord-${version}-x64.AppImage not found in out/make – run "npm run make" first`)
  process.exit(1)
}

function sha256 (file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file).on('data', (d) => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })
}

const lines = []
for (const file of files.sort((a, b) => basename(a).localeCompare(basename(b)))) {
  lines.push(`${await sha256(file)}  ${basename(file)}`)
}
const sums = lines.join('\n') + '\n'

if (!existsSync(keyFile)) {
  console.error('Signing key not found: ' + keyFile)
  process.exit(1)
}
const signature = sign(null, Buffer.from(sums), createPrivateKey(readFileSync(keyFile))).toString('base64') + '\n'
if (!verifySums(sums, signature)) {
  console.error('The signing key does not match RELEASE_KEY in electron/updater.js')
  process.exit(1)
}

writeFileSync(join(make, 'SHA256SUMS'), sums)
writeFileSync(join(make, 'SHA256SUMS.sig'), signature)
process.stdout.write(sums)
console.log('\nWrote out/make/SHA256SUMS and SHA256SUMS.sig')
