// Picks the backend bridge for the platform the UI runs on.
import type { Bridge } from './types'
import { electronBridge } from './electron'
import { androidBridge } from './android'
import { webBridge } from './web.svelte'

function pick (): Bridge {
  if (window.p2p) return electronBridge(window.p2p)
  if (window.P2PNative) return androidBridge(window.P2PNative)
  return webBridge()
}

export const bridge: Bridge = pick()
