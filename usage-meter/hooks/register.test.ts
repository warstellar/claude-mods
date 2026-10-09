import { expect, test } from 'claude-code/testing'

import { formatLeft, level, pillSvg } from './register'

test('levels follow the thresholds', () => {
  expect(level(30)).toBe('ok')
  expect(level(60)).toBe('watch')
  expect(level(90)).toBe('hot')
})

test('time left reads in hours and minutes', () => {
  expect(formatLeft(138 * 60_000)).toBe('2h 18m')
  expect(formatLeft(7 * 60_000)).toBe('7m')
  expect(formatLeft(-5_000)).toBe('0m')
})

test('pill carries percent and countdown', () => {
  const svg = pillSvg(55, '2h 18m')
  expect(svg).toContain('55%')
  expect(svg).toContain('2h 18m')
  expect(svg).not.toContain('·  ')
  expect(pillSvg(55, null)).not.toContain('·')
})
