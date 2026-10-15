import { expect, test } from 'claude-code/testing'

import { formatK, level, marks, pillSvg, waitingSvg } from './register'

test('levels follow the thresholds', () => {
  expect(level(80_000)).toBe('ok')
  expect(level(200_000)).toBe('ok')
  expect(level(250_000)).toBe('watch')
  expect(level(420_000)).toBe('compact')
})

test('formats tokens compactly', () => {
  expect(formatK(312_400)).toBe('312K')
  expect(formatK(1_000_000)).toBe('1M')
  expect(formatK(1_250_000)).toBe('1.25M')
})

test('pill always carries the number and the level color', () => {
  const svg = pillSvg(312_000)
  expect(svg).toContain('312K')
  expect(svg).not.toContain('1M')
  expect(svg).toContain('#EF9F27')
  expect(svg).not.toContain('<animate')
  expect(pillSvg(420_000)).toContain('<animate')
})

test('a 1M window keeps the fixed marks', () => {
  expect(marks(1_000_000)).toEqual({ watch: 250_000, compact: 400_000 })
  expect(level(272_000, 1_000_000)).toBe('watch')
})

test('a 200K window warns before its own auto-compact', () => {
  expect(marks(200_000)).toEqual({ watch: 120_000, compact: 160_000 })
  expect(level(130_000, 200_000)).toBe('watch')
  expect(level(170_000, 200_000)).toBe('compact')
  expect(pillSvg(170_000, 200_000)).toContain('<animate')
})

test('before the first count the pill stays in place, gray, with a question mark', () => {
  const svg = waitingSvg()
  expect(svg).toContain('>?</tspan>')
  expect(svg).not.toContain('#1D9E75')
  expect(svg).not.toContain('stroke-dasharray')
})
