// Desktop: the preload script (electron/preload.js) talks to Electron main,
// which relays to the Bare worker.
import type { Bridge } from './types'

export function electronBridge (p2p: any): Bridge {
  const info = { ...p2p.info(), mobile: false, screenShare: true, bridged: false }
  return {
    ...p2p,
    info: () => info,
    fileUrl: async (rel: string) => 'p2pfile://local/' + rel.split('/').map(encodeURIComponent).join('/'),
    notify: null,
    setCallActive: () => {},
    onBack: () => () => {}
  }
}
