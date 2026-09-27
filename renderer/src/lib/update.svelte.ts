// Update status from the main process (electron/updater.js).
import { bridge } from './rpc'

export interface UpdateState {
  status: 'disabled' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error'
  mode?: 'auto' | 'package' | 'manual'
  current?: string
  latest?: string
  url?: string
  progress?: number
  error?: string | null
  quiet?: boolean
}

export const update = $state<{ state: UpdateState; dismissed: boolean }>({ state: { status: 'idle' }, dismissed: false })

function apply (state: UpdateState) {
  // a new finding shows the banner again even after it was closed
  if (state.status !== update.state.status || state.latest !== update.state.latest) update.dismissed = false
  update.state = state
}

bridge.onUpdateState(apply)
bridge.updateState().then(apply).catch(() => {})

export async function checkUpdates () {
  apply(await bridge.checkUpdates())
}
