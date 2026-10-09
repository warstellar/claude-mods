import { expect, test } from 'claude-code/testing'

import { forecast, formatLeft, level, pillSvg, record, tail } from './register'

const MIN = 60_000
const T0 = 1_000_000_000_000

test('levels follow the thresholds', () => {
  expect(level(30)).toBe('ok')
  expect(level(60)).toBe('watch')
  expect(level(90)).toBe('hot')
})

test('time left reads in hours and minutes', () => {
  expect(formatLeft(138 * MIN)).toBe('2h 18m')
  expect(formatLeft(7 * MIN)).toBe('7m')
  expect(formatLeft(-5_000)).toBe('0m')
})

test('record keeps one sample per change and restarts on a new window', () => {
  let s = record([], { at: T0, percent: 10 }, T0 + 300 * MIN, null)
  s = record(s, { at: T0 + MIN, percent: 10 }, T0 + 300 * MIN, T0 + 300 * MIN)
  expect(s.length).toBe(1)
  s = record(s, { at: T0 + 2 * MIN, percent: 12 }, T0 + 300 * MIN, T0 + 300 * MIN)
  expect(s.length).toBe(2)
  expect(record(s, { at: T0 + 3 * MIN, percent: 1 }, T0 + 300 * MIN, T0 + 300 * MIN)).toEqual([
    { at: T0 + 3 * MIN, percent: 1 },
  ])
  expect(record(s, { at: T0 + 3 * MIN, percent: 13 }, T0 + 600 * MIN, T0 + 300 * MIN).length).toBe(1)
})

test('forecasts running out when the pace beats the reset', () => {
  // 20% in 20 minutes with 40% left: out in about 40 minutes, reset in three hours.
  const samples = [
    { at: T0, percent: 40 },
    { at: T0 + 20 * MIN, percent: 60 },
  ]
  const out = forecast(samples, 60, T0 + 20 * MIN, T0 + 200 * MIN)
  expect(Math.round((out ?? 0) / MIN)).toBe(40)
})

test('stays quiet when the window resets first', () => {
  const samples = [
    { at: T0, percent: 40 },
    { at: T0 + 20 * MIN, percent: 42 },
  ]
  expect(forecast(samples, 42, T0 + 20 * MIN, T0 + 60 * MIN)).toBe(null)
})

test('waits for enough history', () => {
  const samples = [
    { at: T0, percent: 40 },
    { at: T0 + 2 * MIN, percent: 45 },
  ]
  expect(forecast(samples, 45, T0 + 2 * MIN, T0 + 300 * MIN)).toBe(null)
})

test('only the last half hour counts, so idle time slows the pace', () => {
  // A burst an hour ago, then nothing: the recent pace is zero.
  const samples = [
    { at: T0, percent: 10 },
    { at: T0 + 10 * MIN, percent: 50 },
  ]
  expect(forecast(samples, 50, T0 + 70 * MIN, T0 + 300 * MIN)).toBe(null)
})

test('pill shows the forecast in place of the reset time', () => {
  const urgent = tail({ percent: 80, resetsAt: T0 + 120 * MIN, readAt: T0, outIn: 15 * MIN })
  expect(urgent?.text).toBe('out in 15m')
  expect(urgent?.color).toBe('#E24B4A')
  expect(pillSvg(80, urgent)).toContain('out in 15m')

  const calm = tail({ percent: 30, resetsAt: T0 + 138 * MIN, readAt: T0, outIn: null })
  expect(calm?.text).toBe('2h 18m')
})
