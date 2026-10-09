import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Snapshot } from '../types'

const snapshot = atom({ plugin: 'context-meter', key: 'snapshot' } as const, null)
const isCompacting = atom({ plugin: 'context-meter', key: 'isCompacting' } as const, false)

// Every request re-sends the whole context, so each turn costs roughly
// proportional to its size. Past these marks a compact pays for itself fast.
const WATCH_AT = 250_000
const COMPACT_AT = 400_000

export function level(tokens: number): 'ok' | 'watch' | 'compact' {
  if (tokens >= COMPACT_AT) return 'compact'
  if (tokens >= WATCH_AT) return 'watch'
  return 'ok'
}

export function formatK(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(2)}M`
  return `${Math.round(tokens / 1000)}K`
}

const COLORS = { ok: '#1D9E75', watch: '#EF9F27', compact: '#E24B4A' } as const
const MUTED = '#888780'
const RING = 2 * Math.PI * 6

export function pillWidth(tokens: number): number {
  return Math.round(28 + formatK(tokens).length * 7.3 + 10)
}

// One self-contained pill: a ring that fills toward the compact mark (full
// ring = time to compact, not a full window) and the tokens used. Drawn as an
// isolated image, so colors are literal mid-ramp hues that read in both themes.
export function pillSvg(tokens: number): string {
  const lvl = level(tokens)
  const color = COLORS[lvl]
  const used = formatK(tokens)
  const width = pillWidth(tokens)
  const arc = Math.max(1.5, Math.min(1, tokens / COMPACT_AT) * RING)
  const pulse =
    lvl === 'compact'
      ? '<animate attributeName="opacity" values="1;.35;1" dur="1.6s" repeatCount="indefinite"/>'
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">
<rect x="0.5" y="0.5" width="${width - 1}" height="23" rx="11.5" fill="none" stroke="${lvl === 'ok' ? MUTED : color}" stroke-opacity="${lvl === 'ok' ? 0.35 : 0.6}"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2.5"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${RING.toFixed(2)}" transform="rotate(-90 14 12)">${pulse}</circle>
<text x="28" y="16" font-family="ui-monospace, Consolas, monospace" font-size="12"><tspan fill="${color}">${used}</tspan></text>
</svg>`
}

async function refresh($: Parameters<Hook<'turn.complete'>>[0]) {
  try {
    const { context } = await $.session.usage()
    const next: Snapshot = { tokens: context.tokens ?? null, window: context.window }
    await update($, snapshot, () => next)
  } catch {
    // A missed reading only leaves the meter one turn stale.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) await refresh($)
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || snap === null) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const busy = await read($, isCompacting)

    if (snap.tokens === null) {
      return (
        <Box>
          <Text dimColor>Context: fresh window</Text>
        </Box>
      )
    }

    const tokens = snap.tokens
    const lvl = level(tokens)

    const compact = async () => {
      await update($, isCompacting, () => true)
      try {
        const { skip } = await $.session.compact()
        if (skip) $.ui.toast(`Compact skipped: ${skip}`)
      } catch {
        // The direct call can refuse while the engine thinks it's busy; the
        // typed /compact path queues properly, so fall back to it.
        try {
          await $.command.run({ command: 'compact' })
        } catch (err) {
          $.ui.toast(`Compact failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      } finally {
        await update($, isCompacting, () => false)
        await refresh($)
      }
    }

    const button = lvl !== 'ok' && !e.props.isWorking && (
      <Button
        key="compact"
        label={busy ? 'Compacting…' : 'Compact'}
        variant={lvl === 'compact' ? 'primary' : 'secondary'}
        onPress={busy ? () => undefined : compact}
      />
    )

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg
            source={pillSvg(tokens)}
            alt={`Context ${formatK(tokens)}`}
            width={pillWidth(tokens)}
            height={24}
          />
          {button}
        </Box>
      )
    }

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={lvl === 'compact' ? 'error' : lvl === 'watch' ? 'warning' : 'success'}>
          {formatK(tokens)}
        </Text>
        {button}
      </Box>
    )
  })
}
