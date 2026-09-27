import type { UpdateState } from '../update.svelte'

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string | null
}

export interface BridgeInfo {
  version: string
  name: string
  storage: string | null
  platform: string // 'linux' | 'win32' | 'darwin' | 'android' | 'web'
  wayland: boolean
  debug: boolean
  mobile: boolean // phone-sized UI, touch first
  screenShare: boolean // getDisplayMedia works here
  bridged: boolean // the backend runs on a friend's computer (iPhone web app)
}

export interface Bridge {
  info(): BridgeInfo
  start(): Promise<boolean>
  send(bytes: Uint8Array): Promise<boolean>
  onMessage(listener: (bytes: Uint8Array) => void): () => void
  onExit(listener: (code: number) => void): () => void
  pathForFile(file: File): string
  // URL the UI can show a downloaded attachment from (path as fetchFile returned it)
  fileUrl(rel: string, mime?: string): Promise<string>
  writeClipboard(text: string): Promise<void>
  openExternal(url: string): Promise<boolean>
  saveFile(rel: string, name: string): Promise<boolean>
  screenSources(): Promise<ScreenSource[]>
  selectScreen(id: string | null): Promise<boolean>
  streamAudio: {
    available(): Promise<boolean>
    apps(): Promise<{ name: string; binary: string }[]>
    start(app: string | null): Promise<boolean>
    unmute(): Promise<boolean>
    stop(): Promise<boolean>
  }
  onUpdateState(listener: (state: UpdateState) => void): () => void
  updateState(): Promise<UpdateState>
  checkUpdates(): Promise<UpdateState>
  relaunch(): Promise<void>
  setZoom(factor: number): void
  // Mobile: system notification when the app is in the background (null: use web Notification)
  notify: ((title: string, body: string) => void) | null
  // Mobile: keeps the app alive in the background while a call runs
  setCallActive(active: boolean): void
  // Mobile: keeps the app reachable in the background for ms (an open invite); 0 ends it
  keepAwake(ms: number): void
  // Android: stay reachable in the background (backend notifies); null elsewhere
  background: {
    get(): Promise<{ on: boolean; battery: boolean }>
    set(on: boolean): Promise<{ on: boolean; battery: boolean }>
    batteryExempt(): Promise<void>
  } | null
  // A tapped system notification asks to open this chat
  onOpenChat(listener: (space: string, channel: string | null) => void): () => void
  // Android back button: return true when the UI handled it
  onBack(listener: () => boolean): () => void
}

declare global {
  interface Window {
    p2p?: any // Electron preload (see electron/preload.js)
    P2PNative?: any // Android WebMessageListener
  }
}
