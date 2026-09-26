<script lang="ts">
  // The P2Pcord mark: a round speech bubble whose tail forms a lowercase "p",
  // with two connected peers inside. `glyph` draws only the bubble (for buttons).
  let { size = 48, glyph = false }: { size?: number; glyph?: boolean } = $props()
</script>

<svg width={size} height={size} viewBox={glyph ? '138 82 264 334' : '0 0 512 512'} aria-hidden="true">
  {#if !glyph}
    <defs>
      <linearGradient id="p2pcord-logo-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#6c78ff" />
        <stop offset="1" stop-color="#4450d6" />
      </linearGradient>
    </defs>
    <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#p2pcord-logo-bg)" />
  {/if}
  <g transform={glyph ? undefined : 'translate(256 256) scale(1.12) translate(-270 -249)'}>
    <path fill={glyph ? 'currentColor' : '#fff'} d="M150 214A120 120 0 1 1 212 319V352L150 404Z" />
    <path d="M252 214H288" stroke={glyph ? 'var(--logo-cut, #313338)' : '#4f5bf0'} stroke-width="14" stroke-linecap="round" />
    <circle cx="230" cy="214" r="22" fill={glyph ? 'var(--logo-cut, #313338)' : '#4f5bf0'} />
    <circle cx="310" cy="214" r="22" fill={glyph ? 'var(--logo-cut, #313338)' : '#4f5bf0'} />
  </g>
</svg>
