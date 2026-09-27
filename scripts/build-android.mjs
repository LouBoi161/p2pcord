// Builds the Android app (android/):
//   1. Bare Kit runtime (pinned release, cached in ~/.cache/p2pcord)
//   2. the UI (renderer/dist) as the app's assets
//   3. the backend bundle (workers/mobile.js, bare-pack) and its native addons (bare-link)
//   4. Gradle: one APK per ABI into out/make/android/
//
//   node scripts/build-android.mjs [--debug] [--abi arm64-v8a,x86_64] [--skip-ui]
//
// Needs the Android SDK (ANDROID_HOME or ~/Android/Sdk) and JDK 17+. Release
// APKs are signed with android/keystore.properties when it exists.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const debug = args.includes('--debug')
const skipUi = args.includes('--skip-ui')
const abiArg = args[args.indexOf('--abi') + 1]
const ABIS = args.includes('--abi') && abiArg ? abiArg.split(',') : ['arm64-v8a', 'armeabi-v7a', 'x86_64']

const BARE_KIT = {
  version: '2.5.5',
  url: 'https://github.com/holepunchto/bare-kit/releases/download/v2.5.5/prebuilds.zip',
  sha256: 'fc68740347c8532ba49d45bf61fae9ca1f1040dc7d6c99f2f92dc30c40e84e46'
}

const app = join(root, 'android', 'app')
const assets = join(app, 'src', 'main', 'assets')
const jniLibs = join(app, 'jniLibs')
const bin = (name) => join(root, 'node_modules', '.bin', name)
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: 'inherit', cwd: root, ...opts })

async function bareKit () {
  const cache = join(homedir(), '.cache', 'p2pcord', 'bare-kit-' + BARE_KIT.version)
  const lib = join(cache, 'android', 'bare-kit')
  if (!existsSync(join(lib, 'classes.jar'))) {
    mkdirSync(cache, { recursive: true })
    const zip = join(cache, 'prebuilds.zip')
    if (!existsSync(zip)) {
      console.log('fetching', BARE_KIT.url)
      const res = await fetch(BARE_KIT.url)
      if (!res.ok) throw new Error('download failed: ' + res.status)
      await pipeline(Readable.fromWeb(res.body), createWriteStream(zip + '.part'))
      execFileSync('mv', [zip + '.part', zip])
    }
    const hash = createHash('sha256').update(readFileSync(zip)).digest('hex')
    if (hash !== BARE_KIT.sha256) {
      rmSync(zip)
      throw new Error('bare-kit checksum mismatch: ' + hash)
    }
    run('unzip', ['-q', '-o', zip, 'android/*', '-d', cache])
  }
  const target = join(app, 'libs', 'bare-kit')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(join(target, 'jni'), { recursive: true })
  copyFileSync(join(lib, 'classes.jar'), join(target, 'classes.jar'))
  for (const abi of ABIS) cpSync(join(lib, 'jni', abi), join(target, 'jni', abi), { recursive: true })
}

function ui () {
  if (!skipUi) run('npm', ['run', 'build:ui'])
  rmSync(join(assets, 'ui'), { recursive: true, force: true })
  mkdirSync(assets, { recursive: true })
  cpSync(join(root, 'renderer', 'dist'), join(assets, 'ui'), { recursive: true })
}

function backend () {
  mkdirSync(assets, { recursive: true })
  const bundle = join(assets, 'backend.bundle')
  run(bin('bare-pack'), ['--preset', 'android', '--linked', '--out', bundle, 'workers/mobile.js'])
  // link every addon, then keep only those the bundle actually loads
  rmSync(jniLibs, { recursive: true, force: true })
  run(bin('bare-link'), ['--preset', 'android', '--out', jniLibs, '.'])
  const direct = readFileSync(bundle, 'latin1').match(/linked:lib[\w.-]+\.so/g).map((s) => s.slice(7))
  for (const abi of readdirSync(jniLibs)) {
    const dir = join(jniLibs, abi)
    if (!ABIS.includes(abi)) {
      rmSync(dir, { recursive: true, force: true })
      continue
    }
    // addons link against each other (bare-fs needs bare-buffer …): keep the whole closure
    const wanted = new Set()
    const visit = (f) => {
      if (wanted.has(f) || !existsSync(join(dir, f))) return
      wanted.add(f)
      for (const dep of needed(join(dir, f))) visit(dep)
    }
    direct.forEach(visit)
    for (const f of readdirSync(dir)) if (!wanted.has(f)) rmSync(join(dir, f))
    const missing = direct.filter((f) => !existsSync(join(dir, f)))
    if (missing.length) throw new Error(`${abi}: addons missing: ${missing.join(', ')}`)
  }
}

// DT_NEEDED entries of an ELF shared library (64- and 32-bit, little endian)
function needed (file) {
  const b = readFileSync(file)
  const is64 = b[4] === 2
  const u = (off, n) => (n === 8 ? Number(b.readBigUInt64LE(off)) : n === 4 ? b.readUInt32LE(off) : b.readUInt16LE(off))
  const w = is64 ? 8 : 4
  const shoff = u(is64 ? 0x28 : 0x20, w)
  const shentsize = u(is64 ? 0x3a : 0x2e, 2)
  const shnum = u(is64 ? 0x3c : 0x30, 2)
  const sections = []
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize
    sections.push({ type: u(o + 4, 4), offset: u(o + (is64 ? 0x18 : 0x10), w), size: u(o + (is64 ? 0x20 : 0x14), w), link: u(o + (is64 ? 0x28 : 0x18), 4) })
  }
  const dyn = sections.find((s) => s.type === 6) // SHT_DYNAMIC
  if (!dyn) return []
  const strtab = sections[dyn.link]
  const out = []
  for (let o = dyn.offset; o < dyn.offset + dyn.size; o += 2 * w) {
    const tag = u(o, w)
    if (tag === 0) break
    if (tag !== 1) continue // DT_NEEDED
    const start = strtab.offset + u(o + w, w)
    out.push(b.toString('latin1', start, b.indexOf(0, start)))
  }
  return out
}

function javaHome () {
  if (process.env.JAVA_HOME) return process.env.JAVA_HOME
  for (const v of ['21', '17']) {
    const dir = `/usr/lib/jvm/java-${v}-openjdk`
    if (existsSync(dir)) return dir
  }
  return undefined
}

function gradle () {
  const env = { ...process.env }
  env.JAVA_HOME = javaHome()
  env.ANDROID_HOME ||= join(homedir(), 'Android', 'Sdk')
  const task = debug ? 'assembleDebug' : 'assembleRelease'
  run(join(root, 'android', 'gradlew'), [task, '--console=plain', '-Pabis=' + ABIS.join(',')], { cwd: join(root, 'android'), env })
  const outDir = join(root, 'out', 'make', 'android')
  mkdirSync(outDir, { recursive: true })
  const built = join(app, 'build', 'outputs', 'apk', debug ? 'debug' : 'release')
  for (const f of readdirSync(built)) {
    if (!f.endsWith('.apk')) continue
    const abi = ABIS.find((a) => f.includes(a))
    if (!abi) continue
    const name = `P2Pcord-${version}-android-${abi}${debug ? '-debug' : ''}${f.includes('unsigned') ? '-unsigned' : ''}.apk`
    copyFileSync(join(built, f), join(outDir, name))
    console.log('→', join('out', 'make', 'android', name), Math.round(statSync(join(outDir, name)).size / 1e6) + ' MB')
  }
}

await bareKit()
ui()
backend()
gradle()
