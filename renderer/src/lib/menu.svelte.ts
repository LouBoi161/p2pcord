// One context menu for the whole app. Components call openMenu() from an
// oncontextmenu handler; right-clicks nobody handles fall through to the
// native menu of the main process (text fields: spelling, cut/copy/paste).

export interface ActionItem {
  type?: 'item'
  label: string
  icon?: string
  action: () => void
  danger?: boolean
  disabled?: boolean
  checked?: boolean // renders a check mark column
}

export interface SliderItem {
  type: 'slider'
  label: string
  value: number
  min: number
  max: number
  step: number
  format?: (v: number) => string
  oninput: (v: number) => void
  onchange?: () => void
}

export interface SubItem {
  type: 'sub'
  label: string
  icon?: string
  items: MenuEntry[]
}

export interface SepItem {
  type: 'sep'
}

export interface HeaderItem {
  type: 'header'
  label: string
}

export type MenuItem = ActionItem | SliderItem | SubItem | SepItem | HeaderItem
export type MenuEntry = MenuItem | false | null | undefined | '' | 0

export const menu = $state({
  open: false,
  x: 0,
  y: 0,
  items: [] as MenuItem[]
})

// Drops empty entries and separators at the edges or next to each other
export function clean (entries: MenuEntry[]): MenuItem[] {
  const out: MenuItem[] = []
  for (const e of entries) {
    if (!e) continue
    if (e.type === 'sep' && (!out.length || out[out.length - 1].type === 'sep')) continue
    if (e.type === 'sub') {
      const items = clean(e.items)
      if (items.length) out.push({ ...e, items })
      continue
    }
    out.push(e)
  }
  while (out.length && out[out.length - 1].type === 'sep') out.pop()
  return out
}

export function openMenu (e: MouseEvent, entries: MenuEntry[]) {
  e.preventDefault()
  e.stopPropagation()
  const items = clean(entries)
  if (!items.length) return
  menu.items = items
  menu.x = e.clientX
  menu.y = e.clientY
  menu.open = true
}

// For "…" buttons: opens the menu below the button
export function openMenuAt (el: HTMLElement, entries: MenuEntry[]) {
  const r = el.getBoundingClientRect()
  const items = clean(entries)
  if (!items.length) return
  menu.items = items
  menu.x = r.left
  menu.y = r.bottom + 4
  menu.open = true
}

export function closeMenu () {
  menu.open = false
}
