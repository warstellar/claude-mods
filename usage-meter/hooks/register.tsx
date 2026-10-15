import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Week, Window } from '../types'

const fiveHour = atom({ plugin: 'usage-meter', key: 'window' } as const, null)

// Plain thresholds on what's spent: the same for the window and the week.
const WATCH_AT = 70
const HOT_AT = 90
const COLORS = { ok: '#1D9E75', watch: '#EF9F27', hot: '#E24B4A' } as const
const MUTED = '#888780'
const RING = 2 * Math.PI * 6

const WEEK = 7 * 24 * 60 * 60_000

export function formatLeft(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export type Level = 'ok' | 'watch' | 'hot'

const FIVE_HOURS = 5 * 60 * 60_000

function elapsedShare(resetsAt: number | null, readAt: number, length: number): number | null {
  if (resetsAt === null) return null
  return Math.min(1, Math.max(0, 1 - (resetsAt - readAt) / length))
}

export function level(percent: number): Level {
  if (percent >= HOT_AT) return 'hot'
  if (percent >= WATCH_AT) return 'watch'
  return 'ok'
}

export function fiveLevel(win: Window): Level {
  return level(win.percent)
}

export function weekLevel(week: Week | null): Level {
  return week === null ? 'ok' : level(week.percent)
}

export type Strip = {
  label: string
  // Share spent, 0 to 1: the fill, the same quantity the pill's ring shows.
  spent: number
  // Share of the window's time gone, 0 to 1: the tick. Null without a reset.
  elapsed: number | null
  level: Level
  timer: string | null
}

// The hover card: one strip a window, drawn the same way. Fill past the tick
// means spending faster than time passes, and that is what turns it amber;
// the ring and the 5h strip share one color.
export function strips(win: Window): Strip[] {
  const rows: Strip[] = [
    {
      label: '5h',
      spent: win.percent / 100,
      elapsed: elapsedShare(win.resetsAt, win.readAt, FIVE_HOURS),
      level: fiveLevel(win),
      timer: win.resetsAt === null ? null : formatLeft(win.resetsAt - win.readAt),
    },
  ]

  // A reading saved by an older version has no week.
  const week = win.week ?? null
  if (week !== null) {
    rows.push({
      label: 'Week',
      spent: week.percent / 100,
      elapsed: elapsedShare(week.resetsAt, win.readAt, WEEK),
      level: weekLevel(week),
      timer: week.resetsAt === null ? null : formatLeft(week.resetsAt - win.readAt),
    })
  }
  return rows
}

// What a reader that can't see the pill hears.
export function cardText(win: Window): string {
  return strips(win)
    .map(r => `${r.label}: ${Math.round(r.spent * 100)}% used` + (r.timer === null ? '' : `, resets in ${r.timer}`))
    .join('. ')
}

export const STRIP_WIDTH = 96

export function stripSvg(strip: Strip): string {
  const w = STRIP_WIDTH
  const color = COLORS[strip.level]
  const fill = Math.max(strip.spent > 0 ? 3 : 0, Math.min(1, strip.spent) * w)
  const tick =
    strip.elapsed === null
      ? ''
      : `<rect x="${Math.min(w - 2, Math.max(0, strip.elapsed * w - 1)).toFixed(1)}" y="0" width="2" height="12" rx="1" fill="${MUTED}"/>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="12" viewBox="0 0 ${w} 12">
<rect x="0" y="3" width="${w}" height="6" rx="3" fill="${MUTED}" fill-opacity="0.35"/>
<rect x="0" y="3" width="${fill.toFixed(1)}" height="6" rx="3" fill="${color}"/>
${tick}
</svg>`
}

export function pillWidth(percent: number): number {
  return Math.round(28 + `${Math.round(percent)}%`.length * 7.3 + 10)
}

// The ring is the five-hour window only: share spent, colored by its own
// rules, exactly like the 5h strip in the card. The week stays in the card:
// a weekly warning above the prompt is a standing alarm with nothing to do.
export function pillSvg(percent: number, lvl: Level): string {
  const color = COLORS[lvl]
  const width = pillWidth(percent)
  const arc = Math.max(1.5, Math.min(1, percent / 100) * RING)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">
<rect x="0.5" y="0.5" width="${width - 1}" height="23" rx="11.5" fill="none" stroke="${lvl === 'ok' ? MUTED : color}" stroke-opacity="${lvl === 'ok' ? 0.35 : 0.6}"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2.5"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${RING.toFixed(2)}" transform="rotate(-90 14 12)"/>
<text x="28" y="16" font-family="'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace" font-size="12" font-weight="500"><tspan fill="${color}">${Math.round(percent)}%</tspan></text>
</svg>`
}

async function refresh($: Parameters<Hook<'turn.complete'>>[0]) {
  try {
    const { rateLimits } = await $.session.usage()
    const found = rateLimits.find(r => r.kind === 'five_hour')
    const weekly = rateLimits.find(r => r.kind === 'seven_day')
    if (found === undefined) {
      await update($, fiveHour, () => null)
      return
    }

    const now = await $.clock.now()
    const resetsAt = found.resetsAt ? Date.parse(found.resetsAt) : null

    let week: Week | null = null
    if (weekly !== undefined) {
      const weekResetsAt = weekly.resetsAt ? Date.parse(weekly.resetsAt) : null
      week = {
        percent: weekly.percentUsed,
        resetsAt: weekResetsAt,
      }
    }

    const next: Window = {
      percent: found.percentUsed,
      resetsAt,
      readAt: now,
      week,
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
    // The countdown and the tick move even when nobody types.
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

    const five = fiveLevel(win)
    const { Box, Svg, Text } = $.ui.resolve(e as typeof e & { surface: 'desktop' })

    // The card sits over the transcript above the pill and shows while the
    // pointer is on the pill; the app draws it, so it looks like the app.
    const card = (
      <Box
        position="absolute"
        bottom={1}
        left={0}
        display="none"
        hover={{ display: 'flex' }}
        flexDirection="column"
        borderStyle="round"
        borderColor="subtle"
        paddingX={1}
      >
        {strips(win).map(row => (
          <Box key={row.label} flexDirection="row" alignItems="center" gap={1}>
            <Box width={5}>
              <Text bold>{row.label}</Text>
            </Box>
            <Svg source={stripSvg(row)} alt={`${Math.round(row.spent * 100)}% used`} width={STRIP_WIDTH} height={12} />
            {row.timer !== null && <Text dimColor>{`↻ ${row.timer}`}</Text>}
          </Box>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Box key="usage-meter">
          <Svg source={pillSvg(win.percent, five)} alt={cardText(win)} width={pillWidth(win.percent)} height={24} />
          {card}
        </Box>
        {below}
      </Box>
    )
  })
}
