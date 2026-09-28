// Publishes the Android APKs of the current version as an F-Droid repository on
// GitLab Pages: https://louiswalder6.gitlab.io/p2pcord-fdroid/repo
//
//   node scripts/fdroid-repo.mjs [--no-push]
//
// Run after `npm run android`. Needs fdroidserver (`uv tool install fdroidserver`)
// and the Android SDK build-tools. The repo is rebuilt from scratch every time
// with only the current version (clients just update), and pushed as a single
// orphan commit so the site repository does not grow with every release.
//
// The index signing key lives in ~/.config/p2pcord-release/fdroid-repo.p12 (+
// fdroid-repo.properties). Keep a backup: a new key means every user has to
// remove and re-add the repository.
import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = createRequire(import.meta.url)('../package.json')
const pkg = 'io.gitlab.louiswalder6.p2pcord'
const url = 'https://louiswalder6.gitlab.io/p2pcord-fdroid/repo'
const remote = 'https://gitlab.com/louiswalder6/p2pcord-fdroid.git'
const push = !process.argv.includes('--no-push')

const secrets = join(homedir(), '.config', 'p2pcord-release')
const props = Object.fromEntries(readFileSync(join(secrets, 'fdroid-repo.properties'), 'utf8')
  .split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)))

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(homedir(), 'Android', 'Sdk')
const fdroid = [join(homedir(), '.local', 'bin', 'fdroid'), '/usr/bin/fdroid'].find(existsSync) || 'fdroid'

const apks = ['arm64-v8a', 'armeabi-v7a', 'x86_64']
  .map((abi) => join(root, 'out', 'make', 'android', `P2Pcord-${version}-android-${abi}.apk`))
for (const apk of apks) if (!existsSync(apk)) throw new Error(`missing ${apk} – run npm run android first`)

// Version code as in android/app/build.gradle
const [major, minor, patch] = version.split('.').map(Number)
const versionCode = major * 10000 + minor * 100 + patch

const work = join(homedir(), '.cache', 'p2pcord', 'fdroid')
rmSync(work, { recursive: true, force: true })
mkdirSync(join(work, 'repo'), { recursive: true })
cpSync(join(root, 'packaging', 'fdroid', 'metadata'), join(work, 'metadata'), { recursive: true })
for (const apk of apks) copyFileSync(apk, join(work, 'repo', apk.split('/').pop()))

// "What's new" from this version's CHANGELOG section
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const section = changelog.split(/^## /m).find((s) => s.startsWith(`v${version}\n`))
if (section) {
  const dir = join(work, 'metadata', pkg, 'en-US', 'changelogs')
  mkdirSync(dir, { recursive: true })
  const text = section.slice(section.indexOf('\n') + 1).trim().replace(/\*\*/g, '').replace(/\n {2,}/g, ' ')
  writeFileSync(join(dir, `${versionCode}.txt`), text.slice(0, 500) + '\n')
}

writeFileSync(join(work, 'config.yml'), `repo_url: ${url}
repo_name: P2Pcord
repo_description: >-
  Die Android-App von P2Pcord, dem serverlosen, Ende-zu-Ende-verschlüsselten Chat für Freunde.
  Quellcode: https://gitlab.com/louiswalder6/p2pcord
repo_icon: icon.png
archive_older: 0
sdk_path: ${sdk}
repo_keyalias: ${props.keyAlias}
keystore: ${props.storeFile}
keystorepass: {env: FDROID_KEY_PASS}
keypass: {env: FDROID_KEY_PASS}
`, { mode: 0o600 })
// repo_icon is a path relative to the work dir; fdroid copies it to repo/icons/
copyFileSync(join(root, 'build', 'icon', 'icon-256x256.png'), join(work, 'icon.png'))

const env = { ...process.env, FDROID_KEY_PASS: props.storePassword }
execFileSync(fdroid, ['update', '--pretty', '--use-date-from-apk'], { cwd: work, env, stdio: 'inherit' })
execFileSync(fdroid, ['signindex'], { cwd: work, env, stdio: 'inherit' })

// The site repository: repo/ plus a Pages job that serves it
const site = join(work, 'site')
mkdirSync(join(site, 'public'), { recursive: true })
cpSync(join(work, 'repo'), join(site, 'public', 'repo'), { recursive: true })
writeFileSync(join(site, '.gitlab-ci.yml'), `pages:
  image: alpine
  script:
    - echo "F-Droid repo ${url}"
  artifacts:
    paths:
      - public
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`)
const fingerprint = execFileSync('keytool', ['-list', '-keystore', props.storeFile, '-storepass', props.storePassword,
  '-alias', props.keyAlias, '-v'], { encoding: 'utf8' }).match(/SHA256: ([0-9A-F:]+)/)[1].replace(/:/g, '')
const addUrl = `${url}?fingerprint=${fingerprint}`
const index = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>P2Pcord F-Droid-Repo</title>
<body style="font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem;line-height:1.5">
<h1>P2Pcord F-Droid-Repo</h1>
<p>Auf dem Handy mit installiertem F-Droid (oder Droid-ify, Neo Store) antippen:</p>
<p><a href="fdroidrepos://${addUrl.slice(8)}" style="font-size:1.2rem">Repo zu F-Droid hinzufügen</a></p>
<p>Oder in F-Droid unter <i>Einstellungen → Paketquellen → +</i> diese Adresse eintragen:</p>
<p><code style="word-break:break-all">${addUrl}</code></p>
<p>Aktuelle Version: ${version}</p>
`
writeFileSync(join(site, 'public', 'index.html'), index)
writeFileSync(join(site, 'README.md'), `# P2Pcord F-Droid-Repo\n\nIn F-Droid hinzufügen:\n\n    ${addUrl}\n\n` +
  'Wird von `scripts/fdroid-repo.mjs` im P2Pcord-Repo erzeugt – nicht von Hand ändern.\n')

const git = (...args) => execFileSync('git', args, { cwd: site, stdio: 'inherit' })
git('init', '-q', '-b', 'main')
git('add', '-A')
git('commit', '-q', '-m', `F-Droid-Repo: P2Pcord ${version}`)
if (push) git('push', '--force', remote, 'main')
console.log(`\nF-Droid repo for ${version}${push ? ' pushed' : ' built in ' + site}:\n${addUrl}`)
