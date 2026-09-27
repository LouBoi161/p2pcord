// Picks the column count that makes n equally sized tiles (width:height =
// aspect) as large as possible inside a w x h box. Works for any window
// shape: a portrait window ends up with one column, an ultrawide with one row.
export function bestGrid (n: number, w: number, h: number, aspect: number, gap: number) {
  if (n <= 0 || w <= 0 || h <= 0) return { cols: 1, w: Math.max(0, w), h: Math.max(0, h) }
  let best = { cols: 1, w: 0, h: 0 }
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cellW = (w - gap * (cols - 1)) / cols
    const cellH = (h - gap * (rows - 1)) / rows
    const tileW = Math.min(cellW, cellH * aspect)
    if (tileW > best.w) best = { cols, w: tileW, h: tileW / aspect }
  }
  return { cols: best.cols, w: Math.floor(best.w), h: Math.floor(best.h) }
}
