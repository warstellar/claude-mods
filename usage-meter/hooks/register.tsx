import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Window } from '../types'

const fiveHour = atom({ plugin: 'usage-meter', key: 'window' } as const, null)

const WATCH_AT = 60
const HOT_AT = 85
const COLORS = { ok: '#1D9E75', watch: '#EF9F27', hot: '#E24B4A' } as const
const MUTED = '#888780'
const RING = 2 * Math.PI * 6

export function level(percent: number): 'ok' | 'watch' | 'hot' {
  if (percent >= HOT_AT) return 'hot'
  if (percent >= WATCH_AT) return 'watch'
  return 'ok'
}

export function formatLeft(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function textWidth(text: string): number {
  return text.length * 7.3
}

// The ring is the share of the five-hour window already spent; the label adds
// the time until it resets, which is what decides whether to slow down.
export function pillSvg(percent: number, left: string | null): string {
  const color = COLORS[level(percent)]
  const pct = `${Math.round(percent)}%`
  const rest = left === null ? '' : ` · ${left}`
  const width = Math.round(28 + textWidth(pct + rest) + 10)
  const arc = Math.max(1.5, Math.min(1, percent / 100) * RING)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">
<rect x="0.5" y="0.5" width="${width - 1}" height="23" rx="11.5" fill="none" stroke="${level(percent) === 'ok' ? MUTED : color}" stroke-opacity="${level(percent) === 'ok' ? 0.35 : 0.6}"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2.5"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${RING.toFixed(2)}" transform="rotate(-90 14 12)"/>
<text x="28" y="16" font-family="'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace" font-size="12" font-weight="500"><tspan fill="${color}">${pct}</tspan><tspan fill="${MUTED}">${rest}</tspan></text>
</svg>`
}

export function pillWidth(percent: number, left: string | null): number {
  return Math.round(28 + textWidth(`${Math.round(percent)}%` + (left === null ? '' : ` · ${left}`)) + 10)
}

async function refresh($: Parameters<Hook<'turn.complete'>>[0]) {
  try {
    const { rateLimits } = await $.session.usage()
    const found = rateLimits.find(r => r.kind === 'five_hour')
    const readAt = await $.clock.now()
    const next: Window | null = found
      ? {
          percent: found.percentUsed,
          resetsAt: found.resetsAt ? Date.parse(found.resetsAt) : null,
          readAt,
        }
      : null
    await update($, fiveHour, () => next)
  } catch {
    // A missed reading only leaves the pill one turn stale.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    // The countdown moves even when nobody types.
    $.clock.every(60_000, () => refresh($))
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const win = await read($, fiveHour)
    if (e.props.hasSurvey || win === null || e.surface !== 'desktop') return below

    const left = win.resetsAt === null ? null : formatLeft(win.resetsAt - win.readAt)
    const { Box, Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Svg
          source={pillSvg(win.percent, left)}
          alt={`Five-hour usage ${Math.round(win.percent)}%${left ? `, resets in ${left}` : ''}`}
          width={pillWidth(win.percent, left)}
          height={24}
        />
        {below}
      </Box>
    )
  })
}
