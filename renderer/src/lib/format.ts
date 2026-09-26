// Safe message formatting: everything is HTML-escaped first, then a small
// markdown subset is applied. No user-provided HTML ever reaches the DOM.

function escape (s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

const URL_RE = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g

function inline (s: string) {
  return s
    .replace(URL_RE, (url) => `<a data-href="${url}" title="${url}">${url}</a>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
    .replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler">$1</span>')
}

export function renderText (text: string): string {
  const parts = text.split(/```(?:[a-z0-9]*\n)?([\s\S]*?)```/g)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      out += `<pre><code>${escape(parts[i].replace(/\n$/, ''))}</code></pre>`
      continue
    }
    const segs = escape(parts[i]).split(/`([^`\n]+)`/g)
    out += segs.map((seg, j) => (j % 2 === 1 ? `<code>${seg}</code>` : inline(seg))).join('')
  }
  return out.replace(/\n/g, '<br>')
}

export function isEmojiOnly (text: string) {
  return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|\s){1,20}$/u.test(text) && !/^[\d\s#*]+$/.test(text)
}

export function formatTime (ts: number) {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

export function formatDay (ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Heute'
  if (d.toDateString() === yesterday.toDateString()) return 'Gestern'
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function formatStamp (ts: number) {
  const day = formatDay(ts)
  const time = formatTime(ts)
  return day === 'Heute' ? `Heute um ${time}` : day === 'Gestern' ? `Gestern um ${time}` : `${day} ${time}`
}

export function formatSize (bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB'
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

// Short, human-comparable fingerprint for verifying identities (like Signal's safety numbers)
export function fingerprint (hex: string) {
  const groups: string[] = []
  for (let i = 0; i < 40; i += 5) {
    const n = parseInt(hex.slice(i, i + 5), 16) % 100000
    groups.push(String(n).padStart(5, '0'))
  }
  return groups.join(' ')
}

export async function safetyNumber (a: string, b: string) {
  const [x, y] = [a, b].sort()
  const data = new TextEncoder().encode('p2pcord-safety:' + x + y)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data))
  const hex = [...hash].map((v) => v.toString(16).padStart(2, '0')).join('')
  return fingerprint(hex)
}
