import { expect, test } from 'claude-code/testing'

import { cardText, fiveLevel, forecast, formatLeft, level, pillSvg, record, stripSvg, strips, weekForecast, weekLevel } from './register'

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

const HOUR = 60 * MIN
const DAY = 24 * HOUR

test('time left reads in days past a day', () => {
  expect(formatLeft(4 * DAY + 3 * HOUR + 20 * MIN)).toBe('4d 3h')
})

test('week runs out when its average pace beats the reset', () => {
  // Two days in, 50% spent: the rest goes in two more days, three before reset.
  const out = weekForecast(50, T0, T0 + 5 * DAY)
  expect(Math.round((out ?? 0) / HOUR)).toBe(48)
})

test('week stays quiet when it lasts, or when it is too early to tell', () => {
  // A day in, 12% spent: on pace for about 84%.
  expect(weekForecast(12, T0, T0 + 6 * DAY)).toBe(null)
  // Two hours in, 10% spent: too little of the week to judge.
  expect(weekForecast(10, T0, T0 + 7 * DAY - 2 * HOUR)).toBe(null)
})

const win = (over: Partial<Parameters<typeof strips>[0]>) => ({
  percent: 12,
  resetsAt: T0 + 205 * MIN,
  readAt: T0,
  outIn: null,
  week: null,
  ...over,
})

test('the 5h color stays calm below 40% even when a burst forecasts running out', () => {
  expect(fiveLevel(win({ percent: 12, outIn: 98 * MIN }))).toBe('ok')
  expect(fiveLevel(win({ percent: 45, outIn: 98 * MIN }))).toBe('watch')
  expect(fiveLevel(win({ percent: 45, outIn: 15 * MIN }))).toBe('hot')
  expect(fiveLevel(win({ percent: 90, outIn: null }))).toBe('hot')
})

test('the week color warns only when it runs out before the reset', () => {
  expect(weekLevel({ percent: 50, resetsAt: T0 + 5 * DAY, outIn: 2 * DAY })).toBe('watch')
  expect(weekLevel({ percent: 90, resetsAt: T0 + 2 * DAY, outIn: 10 * HOUR })).toBe('hot')
  expect(weekLevel({ percent: 12, resetsAt: T0 + 6 * DAY, outIn: null })).toBe('ok')
  expect(weekLevel(null)).toBe('ok')
})

test('pill shows the percent, and a dot only when the week runs out', () => {
  const calm = pillSvg(12, 'ok')
  expect(calm).toContain('>12%</tspan>')
  expect(calm).not.toContain('r="3"')
  expect(pillSvg(12, 'ok', 'watch')).toContain('r="3" fill="#EF9F27"')
})

test('each window is one strip: spent, time gone, its color and the reset', () => {
  const [five, week] = strips(win({ week: { percent: 13, resetsAt: T0 + 6 * DAY, outIn: null } }))
  expect(five?.label).toBe('5h')
  expect(Math.round((five?.spent ?? 0) * 100)).toBe(12)
  // 3h 25m left of five hours: 1h 35m gone.
  expect(Math.round((five?.elapsed ?? 0) * 300)).toBe(95)
  expect(five?.timer).toBe('3h 25m')
  expect(Math.round((week?.elapsed ?? 0) * 7 * 24)).toBe(24)
  expect(week?.timer).toBe('6d')
})

test('the 5h strip always takes the same color as the ring', () => {
  const w = win({ percent: 45, outIn: 15 * MIN, week: { percent: 50, resetsAt: T0 + 5 * DAY, outIn: 2 * DAY } })
  const [five, week] = strips(w)
  expect(five?.level).toBe(fiveLevel(w))
  expect(week?.level).toBe('watch')
  expect(stripSvg(five!)).toContain('#E24B4A')
})

test('a reading from an older version without a week still draws', () => {
  const old = { percent: 6, resetsAt: null, readAt: T0, outIn: null } as unknown as Parameters<typeof strips>[0]
  expect(strips(old).length).toBe(1)
  expect(stripSvg(strips(old)[0]!)).not.toContain('width="2"')
  expect(cardText(old)).toBe('5h: 6% used')
})

test('spoken text names the reset', () => {
  expect(cardText(win({}))).toBe('5h: 12% used, resets in 3h 25m')
})
