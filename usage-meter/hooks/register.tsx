import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Sample, Window } from '../types'

const fiveHour = atom({ plugin: 'usage-meter', key: 'window' } as const, null)

const WATCH_AT = 60
const HOT_AT = 85
const COLORS = { ok: '#1D9E75', watch: '#EF9F27', hot: '#E24B4A' } as const
const MUTED = '#888780'
const RING = 2 * Math.PI * 6

// The forecast reads the pace of the last half hour, so an idle hour earlier
// doesn't flatter it, and waits for enough history not to jump around.
const PACE_WINDOW = 30 * 60_000
const MIN_SPAN = 5 * 60_000
const MIN_DELTA = 1
const KEEP_FOR = 2 * 60 * 60_000
const URGENT = 20 * 60_000

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

// Keeps one sample per change of the reading; a new window (the reset moved,
// or usage fell) starts the history over.
export function record(
  samples: readonly Sample[],
  sample: Sample,
  resetsAt: number | null,
  lastResetsAt: number | null,
): Sample[] {
  const last = samples.at(-1)
  const isNewWindow =
    (last !== undefined && sample.percent < last.percent - 0.5) ||
    (resetsAt !== null && lastResetsAt !== null && Math.abs(resetsAt - lastResetsAt) > 60_000)
  const kept = isNewWindow ? [] : samples.filter(s => s.at >= sample.at - KEEP_FOR)
  if (kept.at(-1)?.percent === sample.percent) return kept
  return [...kept, sample]
}

// Milliseconds until the window runs out at the recent pace, or null when it
// won't run out before it resets (or there isn't enough history to say).
export function forecast(
  samples: readonly Sample[],
  percent: number,
  now: number,
  resetsAt: number | null,
): number | null {
  const start = now - PACE_WINDOW
  const before = samples.filter(s => s.at <= start).at(-1)
  const base = before ? { at: start, percent: before.percent } : samples[0]
  if (base === undefined) return null

  const span = now - base.at
  const delta = percent - base.percent
  if (span < MIN_SPAN || delta < MIN_DELTA) return null

  const msToEmpty = ((100 - percent) / delta) * span
  if (resetsAt !== null && now + msToEmpty >= resetsAt) return null
  return msToEmpty
}

export type Tail = { text: string; color: string }

export function tail(win: Window): Tail | null {
  if (win.outIn !== null) {
    return { text: `out in ${formatLeft(win.outIn)}`, color: win.outIn <= URGENT ? COLORS.hot : COLORS.watch }
  }
  if (win.resetsAt !== null) return { text: formatLeft(win.resetsAt - win.readAt), color: MUTED }
  return null
}

function label(percent: number, end: Tail | null): string {
  return `${Math.round(percent)}%` + (end === null ? '' : ` · ${end.text}`)
}

export function pillWidth(percent: number, end: Tail | null): number {
  return Math.round(28 + label(percent, end).length * 7.3 + 10)
}

// The ring is the share of the five-hour window already spent. The label adds
// the time until it resets, or, when the recent pace would empty it first,
// how long until it runs out.
export function pillSvg(percent: number, end: Tail | null): string {
  const color = COLORS[level(percent)]
  const width = pillWidth(percent, end)
  const arc = Math.max(1.5, Math.min(1, percent / 100) * RING)
  const rest = end === null ? '' : `<tspan fill="${MUTED}"> · </tspan><tspan fill="${end.color}">${end.text}</tspan>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">
<rect x="0.5" y="0.5" width="${width - 1}" height="23" rx="11.5" fill="none" stroke="${level(percent) === 'ok' ? MUTED : color}" stroke-opacity="${level(percent) === 'ok' ? 0.35 : 0.6}"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2.5"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${RING.toFixed(2)}" transform="rotate(-90 14 12)"/>
<text x="28" y="16" font-family="'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace" font-size="12" font-weight="500"><tspan fill="${color}">${Math.round(percent)}%</tspan>${rest}</text>
</svg>`
}

async function refresh($: Parameters<Hook<'turn.complete'>>[0]) {
  try {
    const { rateLimits } = await $.session.usage()
    const found = rateLimits.find(r => r.kind === 'five_hour')
    if (found === undefined) {
      await update($, fiveHour, () => null)
      return
    }

    const now = await $.clock.now()
    const resetsAt = found.resetsAt ? Date.parse(found.resetsAt) : null
    const stored = ((await $.store.get('samples')) ?? []) as Sample[]
    const lastResetsAt = ((await $.store.get('resetsAt')) ?? null) as number | null
    const samples = record(stored, { at: now, percent: found.percentUsed }, resetsAt, lastResetsAt)
    await $.store.set('samples', samples)
    await $.store.set('resetsAt', resetsAt)

    const next: Window = {
      percent: found.percentUsed,
      resetsAt,
      readAt: now,
      outIn: forecast(samples, found.percentUsed, now, resetsAt),
    }
    await update($, fiveHour, () => next)
  } catch {
    // A missed reading only leaves the pill one turn stale.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    // The countdown and the pace move even when nobody types.
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

    const end = tail(win)
    const { Box, Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Svg
          source={pillSvg(win.percent, end)}
          alt={`Five-hour usage ${Math.round(win.percent)}%${end ? `, ${end.text}` : ''}`}
          width={pillWidth(win.percent, end)}
          height={24}
        />
        {below}
      </Box>
    )
  })
}
