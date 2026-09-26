// JSON-RPC to the Bare backend worker via the preload bridge.

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string | null
}

interface Bridge {
  info(): { version: string; name: string; storage: string | null; platform: string; debug: boolean }
  start(): Promise<boolean>
  send(bytes: Uint8Array): Promise<boolean>
  onMessage(listener: (bytes: Uint8Array) => void): () => void
  onExit(listener: (code: number) => void): () => void
  pathForFile(file: File): string
  writeClipboard(text: string): Promise<void>
  openExternal(url: string): Promise<boolean>
  showFile(rel: string): Promise<boolean>
  screenSources(): Promise<ScreenSource[]>
  selectScreen(id: string | null): Promise<boolean>
  onUpdateReady(listener: () => void): () => void
  applyUpdate(): Promise<boolean>
  relaunch(): Promise<void>
}

declare global {
  interface Window {
    p2p: Bridge
  }
}

export const bridge = window.p2p

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
const listeners = new Map<string, Set<(data: any) => void>>()
let nextId = 1

bridge.onMessage((bytes) => {
  let msg: any
  try {
    msg = JSON.parse(decoder.decode(bytes))
  } catch {
    return
  }
  if (typeof msg.id === 'number') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error))
    else p.resolve(msg.result)
    return
  }
  if (typeof msg.event === 'string') {
    for (const fn of listeners.get(msg.event) || []) fn(msg.data)
  }
})

bridge.onExit((code) => {
  for (const p of pending.values()) p.reject(new Error('BACKEND_EXITED'))
  pending.clear()
  for (const fn of listeners.get('exit') || []) fn(code)
})

export function call<T = any> (method: string, params: Record<string, any> = {}): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    bridge.send(encoder.encode(JSON.stringify({ id, method, params }))).catch((err) => {
      pending.delete(id)
      reject(err)
    })
  })
}

export function on (event: string, fn: (data: any) => void): () => void {
  let set = listeners.get(event)
  if (!set) listeners.set(event, (set = new Set()))
  set.add(fn)
  return () => set!.delete(fn)
}

export function start () {
  return bridge.start()
}
