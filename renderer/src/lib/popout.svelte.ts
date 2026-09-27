// Streams in their own window, like Discord's pop-out. The window is a
// same-origin about:blank child of the main window, so it lives in the same
// renderer process: the MediaStream and all state are shared directly, no
// copies, no extra decoding.
import { mount, unmount } from 'svelte'
import PopoutStream from '../components/PopoutStream.svelte'
import { toast, memberName, ui } from './state.svelte'

export const popped = $state<Record<string, boolean>>({})
const windows = new Map<string, Window>()

export function popOut (identity: string) {
  const open = windows.get(identity)
  if (open && !open.closed) {
    open.focus()
    return
  }
  const win = window.open('', 'p2pcord-stream-' + identity.slice(0, 16), 'width=1280,height=720')
  if (!win) {
    toast('Das Fenster konnte nicht geöffnet werden.', 'error')
    return
  }
  const space = ui.spaces[(ui.peers[identity]?.voice?.space) || '']
  const doc = win.document
  doc.title = `${memberName(space, identity)}s Bildschirm – P2Pcord`
  // same styles and theme as the main window
  for (const el of document.querySelectorAll('link[rel="stylesheet"], style')) {
    if (el instanceof HTMLLinkElement) {
      const link = doc.createElement('link')
      link.rel = 'stylesheet'
      link.href = el.href
      doc.head.appendChild(link)
    } else doc.head.appendChild(el.cloneNode(true))
  }
  doc.documentElement.setAttribute('style', document.documentElement.getAttribute('style') || '')
  for (const a of document.documentElement.getAttributeNames()) {
    if (a.startsWith('data-')) doc.documentElement.setAttribute(a, document.documentElement.getAttribute(a)!)
  }
  doc.body.style.margin = '0'
  doc.body.style.background = '#000'

  const app = mount(PopoutStream, { target: doc.body, props: { identity, win } })
  windows.set(identity, win)
  popped[identity] = true
  win.addEventListener('pagehide', () => {
    unmount(app)
    windows.delete(identity)
    delete popped[identity]
  })
}

export function closePopout (identity: string) {
  windows.get(identity)?.close()
}

export function closeAllPopouts () {
  for (const w of windows.values()) w.close()
}

window.addEventListener('beforeunload', closeAllPopouts)
