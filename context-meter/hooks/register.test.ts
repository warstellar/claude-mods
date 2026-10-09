import { expect, test } from 'claude-code/testing'

import { formatK, level, pillSvg } from './register'

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
