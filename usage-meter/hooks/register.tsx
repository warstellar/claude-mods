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

export type Pace = 'ahead' | 'on' | 'behind'

// The pace compares what's spent with how much of the window's time has gone.
// Too early in a window a single reply looks like racing ahead, and right at
// the line it would flicker, so it stays quiet there.
const PACE_MARGIN = 0.05
const FIVE_PACE_FROM = 0.1
const WEEK_PACE_FROM = 12 * 60 * 60_000 / WEEK

export function pace(spent: number, elapsed: number | null, from: number): Pace | null {
  if (elapsed === null || elapsed < from) return null
  if (spent - elapsed >= PACE_MARGIN) return 'ahead'
  if (elapsed - spent >= PACE_MARGIN) return 'behind'
  return 'on'
}

export type Strip = {
  label: string
  // Share spent, 0 to 1: the fill, the same quantity the pill's ring shows.
  spent: number
  // Share of the window's time gone, 0 to 1: the tick. Null without a reset.
  elapsed: number | null
  level: Level
  timer: string | null
  pace: Pace | null
}

// The hover card's rows: one a window, drawn the same way; the ring and the
// 5h row share one color.
export function strips(win: Window): Strip[] {
  const elapsed = elapsedShare(win.resetsAt, win.readAt, FIVE_HOURS)
  const rows: Strip[] = [
    {
      label: '5h',
      spent: win.percent / 100,
      elapsed,
      level: fiveLevel(win),
      timer: win.resetsAt === null ? null : formatLeft(win.resetsAt - win.readAt),
      pace: pace(win.percent / 100, elapsed, FIVE_PACE_FROM),
    },
  ]

  // A reading saved by an older version has no week.
  const week = win.week ?? null
  if (week !== null) {
    const weekElapsed = elapsedShare(week.resetsAt, win.readAt, WEEK)
    rows.push({
      label: 'Week',
      spent: week.percent / 100,
      elapsed: weekElapsed,
      level: weekLevel(week),
      timer: week.resetsAt === null ? null : formatLeft(week.resetsAt - win.readAt),
      pace: pace(week.percent / 100, weekElapsed, WEEK_PACE_FROM),
    })
  }
  return rows
}

// Only racing ahead earns a mark above the prompt; the calm states wait in
// the card.
export function fiveAhead(win: Window): boolean {
  return strips(win)[0]?.pace === 'ahead'
}

// What a reader that can't see the pill hears.
export function cardText(win: Window): string {
  return strips(win)
    .map(
      r =>
        `${r.label}: ${Math.round(r.spent * 100)}% used` +
        (r.timer === null ? '' : `, resets in ${r.timer}`) +
        (r.pace === 'ahead' ? ', faster than the window' : ''),
    )
    .join('. ')
}

// How far spending runs ahead of the window's time (positive) or behind it,
// in whole percent.
export function paceGap(strip: Strip): number | null {
  if (strip.pace === null || strip.elapsed === null) return null
  return Math.round((strip.spent - strip.elapsed) * 100)
}

const FONT = "'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace"

// One arrow for every pace, turned: up-right ahead, right on pace, down-right
// behind, so the three are the same size. Drawn around (cx, cy), the same
// line every text in a row is centered on.
const TURN: Record<Pace, number> = { ahead: -45, on: 0, behind: 45 }

function arrow(pace: Pace, cx: number, cy: number, color: string): string {
  return `<path d="M-4.5 0 H4.5 M1 -3.5 L4.5 0 L1 3.5" transform="translate(${cx.toFixed(1)} ${cy}) rotate(${TURN[pace]})" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
}

// The reset mark, drawn rather than typed so it matches the arrows: the
// usual rotate-clockwise icon, scaled into the same 10px box.
function resetIcon(cx: number, cy: number, color: string): string {
  return `<g transform="translate(${(cx - 5).toFixed(1)} ${cy - 5}) scale(0.42)" fill="none" stroke="${color}" stroke-width="3.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></g>`
}

function text(x: number, cy: number, body: string, attrs: string): string {
  return `<text x="${x.toFixed(1)}" y="${cy}" dominant-baseline="central" ${attrs}>${body}</text>`
}

// Columns: name, percent, bar, then the pace read off the bar, and the reset
// last and quietest: it's background, not part of how much is spent.
const ROW = 26
const PCT_END = 76
const BAR_X = 84
const BAR_W = 150
const BAR_H = 8
const ICON_CX = BAR_X + BAR_W + 14
const DELTA_X = ICON_CX + 10
const RESET_CX = DELTA_X + 50
const TIMER_X = RESET_CX + 9
export const CARD_WIDTH = TIMER_X + 56

export function cardHeight(rows: number): number {
  return rows * ROW
}

// The whole card as one picture, so the rows line up to the pixel, drawn
// like the app's own usage bars: a flat track with a solid fill. The marker
// above the bar is how much of the window's time has gone. Spending past it
// is split off in amber, and the arrow and number right after the bar say how
// far ahead or behind you are; the reset comes last.
export function cardSvg(rows: readonly Strip[]): string {
  const body = rows
    .map((row, i) => {
      const cy = i * ROW + ROW / 2 + 3
      const y = cy - BAR_H / 2
      const color = COLORS[row.level]
      const fillEnd = BAR_X + Math.min(1, row.spent) * BAR_W
      const tickX = row.elapsed === null ? null : BAR_X + row.elapsed * BAR_W
      const split = row.pace === 'ahead' && tickX !== null
      const fill = split
        ? `<rect x="${BAR_X}" y="${y}" width="${(tickX - BAR_X - 1).toFixed(1)}" height="${BAR_H}" fill="${color}"/>
<rect x="${(tickX + 1).toFixed(1)}" y="${y}" width="${(fillEnd - tickX - 1).toFixed(1)}" height="${BAR_H}" fill="${COLORS.watch}" fill-opacity="0.5"/>`
        : `<rect x="${BAR_X}" y="${y}" width="${(fillEnd - BAR_X).toFixed(1)}" height="${BAR_H}" fill="${color}"/>`
      const marker =
        tickX === null
          ? ''
          : (t => `<polygon points="${(t - 3.5).toFixed(1)},${y - 6} ${(t + 3.5).toFixed(1)},${y - 6} ${t.toFixed(1)},${y - 2}" fill="${MUTED}"/>`)(
              Math.min(BAR_X + BAR_W - 1, Math.max(BAR_X + 1, tickX)),
            )
      const gap = paceGap(row)
      const paceColor = row.pace === 'ahead' ? COLORS.watch : MUTED
      return `<g>
<clipPath id="bar${i}"><rect x="${BAR_X}" y="${y}" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath>
${text(0, cy, row.label, `font-size="12" font-weight="600" fill="${MUTED}"`)}
${text(PCT_END, cy, `${Math.round(row.spent * 100)}%`, `font-size="12" font-weight="600" text-anchor="end" fill="${color}"`)}
<g clip-path="url(#bar${i})">
<rect x="${BAR_X}" y="${y}" width="${BAR_W}" height="${BAR_H}" fill="${MUTED}" fill-opacity="0.25"/>
${fill}
</g>
${marker}
${row.timer === null ? '' : `${resetIcon(RESET_CX, cy, MUTED)}
${text(TIMER_X, cy, row.timer, `font-size="11" fill="${MUTED}"`)}`}
${row.pace === null ? '' : arrow(row.pace, ICON_CX, cy, paceColor)}
${gap === null || row.pace === 'on' ? '' : text(DELTA_X, cy, `${gap > 0 ? '+' : '−'}${Math.abs(gap)}%`, `font-size="11" fill="${paceColor}"`)}
</g>`
    })
    .join('\n')
  const h = cardHeight(rows.length)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${h}" viewBox="0 0 ${CARD_WIDTH} ${h}" font-family="${FONT}">
${body}
</svg>`
}

const ARROW = 12

function textEnd(percent: number): number {
  return 28 + `${Math.round(percent)}%`.length * 7.3
}

export function pillWidth(percent: number, ahead = false): number {
  return Math.round(textEnd(percent) + (ahead ? ARROW : 0) + 10)
}

// The ring is the five-hour window only: share spent, colored by its own
// rules, exactly like the 5h bar in the card. The week stays in the card:
// a weekly warning above the prompt is a standing alarm with nothing to do.
// The card's ahead arrow follows the number when the window is being spent
// faster than its time passes: the one pace state worth seeing without
// hovering.
export function pillSvg(percent: number, lvl: Level, ahead = false): string {
  const color = COLORS[lvl]
  const width = pillWidth(percent, ahead)
  const arc = Math.max(1.5, Math.min(1, percent / 100) * RING)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24" font-family="${FONT}">
<rect x="0.5" y="0.5" width="${width - 1}" height="23" rx="11.5" fill="none" stroke="${lvl === 'ok' ? MUTED : color}" stroke-opacity="${lvl === 'ok' ? 0.35 : 0.6}"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2.5"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${RING.toFixed(2)}" transform="rotate(-90 14 12)"/>
${text(28, 12, `<tspan fill="${color}">${Math.round(percent)}%</tspan>`, 'font-size="12" font-weight="500"')}
${ahead ? arrow('ahead', textEnd(percent) + 8, 12, color) : ''}
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
    const ahead = fiveAhead(win)
    const rows = strips(win)
    const { Box, Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })

    // The card sits over the transcript above the pill and shows while the
    // pointer is on the pill; the app draws it, so it looks like the app.
    const card = (
      <Box
        position="absolute"
        bottom={1}
        left={0}
        display="none"
        hover={{ display: 'flex' }}
        borderStyle="round"
        borderColor="subtle"
        paddingX={1}
        paddingY={1}
        flexShrink={0}
      >
        <Svg source={cardSvg(rows)} alt={cardText(win)} width={CARD_WIDTH} height={cardHeight(rows.length)} />
      </Box>
    )

    return (
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Box key="usage-meter">
          <Svg
            source={pillSvg(win.percent, five, ahead)}
            alt={cardText(win)}
            width={pillWidth(win.percent, ahead)}
            height={24}
          />
          {card}
        </Box>
        {below}
      </Box>
    )
  })
}
