import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Snapshot } from '../types'

const snapshot = atom({ plugin: 'context-meter', key: 'snapshot' } as const, null)
const isCompacting = atom({ plugin: 'context-meter', key: 'isCompacting' } as const, false)

// Past these marks a long thread costs more each turn and the model starts
// losing track of what was settled early on, so a compact pays for itself.
// A smaller window (200K) would auto-compact before ever reaching them, so
// there they scale down to its share instead.
const WATCH_AT = 250_000
const COMPACT_AT = 400_000
const WATCH_SHARE = 0.6
const COMPACT_SHARE = 0.8

export function marks(window?: number): { watch: number; compact: number } {
  if (!window || window <= 0) return { watch: WATCH_AT, compact: COMPACT_AT }
  return {
    watch: Math.min(WATCH_AT, Math.round(window * WATCH_SHARE)),
    compact: Math.min(COMPACT_AT, Math.round(window * COMPACT_SHARE)),
  }
}

export function level(tokens: number, window?: number): 'ok' | 'watch' | 'compact' {
  const m = marks(window)
  if (tokens >= m.compact) return 'compact'
  if (tokens >= m.watch) return 'watch'
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
export function pillSvg(tokens: number, window?: number): string {
  const lvl = level(tokens, window)
  const color = COLORS[lvl]
  const used = formatK(tokens)
  const width = pillWidth(tokens)
  const arc = Math.max(1.5, Math.min(1, tokens / marks(window).compact) * RING)
  const pulse =
    lvl === 'compact'
      ? '<animate attributeName="opacity" values="1;.35;1" dur="1.6s" repeatCount="indefinite"/>'
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">
<rect x="0.5" y="0.5" width="${width - 1}" height="23" rx="11.5" fill="none" stroke="${lvl === 'ok' ? MUTED : color}" stroke-opacity="${lvl === 'ok' ? 0.35 : 0.6}"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2.5"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="${arc.toFixed(2)} ${RING.toFixed(2)}" transform="rotate(-90 14 12)">${pulse}</circle>
<text x="28" y="16" font-family="'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace" font-size="12" font-weight="500"><tspan fill="${color}">${used}</tspan></text>
</svg>`
}

// Right after a compact the app has no count until the next reply. Keep the
// pill in its place, empty and gray with a "?", so nothing jumps around.
export const WAITING_WIDTH = 46

export function waitingSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WAITING_WIDTH}" height="24" viewBox="0 0 ${WAITING_WIDTH} 24">
<rect x="0.5" y="0.5" width="${WAITING_WIDTH - 1}" height="23" rx="11.5" fill="none" stroke="${MUTED}" stroke-opacity="0.35"/>
<circle cx="14" cy="12" r="6" fill="none" stroke="${MUTED}" stroke-opacity="0.35" stroke-width="2.5"/>
<text x="28" y="16" font-family="'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Mono', Consolas, monospace" font-size="12" font-weight="500"><tspan fill="${MUTED}">?</tspan></text>
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
    const below = await next(e)
    const snap = await read($, snapshot)
    if (e.props.hasSurvey || snap === null) return below

    const { Box, Button, Text } = $.ui.resolve(e)
    const busy = await read($, isCompacting)

    if (snap.tokens === null) {
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })
        const hint = (
          <Box
            position="absolute"
            bottom={1}
            left={0}
            display="none"
            hover={{ display: 'flex' }}
            borderStyle="round"
            borderColor="subtle"
            paddingX={1}
          >
            <Text dimColor>Counted after the next reply</Text>
          </Box>
        )
        return (
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Box key="context-meter">
              <Svg source={waitingSvg()} alt="Context: counted after the next reply" width={WAITING_WIDTH} height={24} />
              {hint}
            </Box>
            {below}
          </Box>
        )
      }
      return (
        <Box flexDirection="row" gap={1}>
          <Text dimColor>?</Text>
          {below}
        </Box>
      )
    }

    const tokens = snap.tokens
    const lvl = level(tokens, snap.window)

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

    // The button only shows when it's time, so it's always the main action:
    // primary, with a clamp glyph so it reads as "squeeze" at a glance.
    const button = lvl !== 'ok' && !e.props.isWorking && (
      <Button
        key="compact"
        label={busy ? '🗜 Compacting…' : '🗜 Compact'}
        variant="primary"
        onPress={busy ? () => undefined : compact}
      />
    )

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e as typeof e & { surface: 'desktop' })
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Svg
            source={pillSvg(tokens, snap.window)}
            alt={`Context ${formatK(tokens)}`}
            width={pillWidth(tokens)}
            height={24}
          />
          {button}
          {below}
        </Box>
      )
    }

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={lvl === 'compact' ? 'error' : lvl === 'watch' ? 'warning' : 'success'}>
          {formatK(tokens)}
        </Text>
        {button}
        {below}
      </Box>
    )
  })
}
