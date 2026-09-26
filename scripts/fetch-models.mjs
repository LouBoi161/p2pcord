// Downloads the DeepFilterNet3 noise-suppression assets once at build time and
// pins them by SHA-256, so the app never loads code or models from the network
// at runtime.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'public', 'dfn3', 'v3')

const ASSETS = [
  {
    file: 'pkg/df_bg.wasm',
    // Must match the wasm-bindgen glue inside deepfilternet3-noise-filter@1.3.0
    url: 'https://cdn.mezon.ai/AI/models/datas/noise_suppression/deepfilternet3/v3/pkg/df_bg.wasm',
    sha256: '440b5d12b6ea7d95008736f844221d7874ee15de5cb10d3015002470fdba0432'
  },
  {
    file: 'models/DeepFilterNet3_onnx.tar.gz',
    // Official model from the DeepFilterNet repository (MIT/Apache-2.0)
    url: 'https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3_onnx.tar.gz',
    sha256: 'c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616'
  }
]

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

for (const asset of ASSETS) {
  const target = join(root, asset.file)
  if (existsSync(target) && sha256(readFileSync(target)) === asset.sha256) continue

  console.log('fetching', asset.url)
  const res = await fetch(asset.url)
  if (!res.ok) throw new Error(`download failed (${res.status}): ${asset.url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const hash = sha256(buf)
  if (hash !== asset.sha256) throw new Error(`checksum mismatch for ${asset.file}: ${hash}`)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, buf)
}
console.log('noise suppression models ok')
