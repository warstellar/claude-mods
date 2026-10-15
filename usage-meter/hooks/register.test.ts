import { expect, test } from 'claude-code/testing'

import { cardText, fiveLevel, formatLeft, pillSvg, stripSvg, strips, weekForecast, weekLevel } from './register'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const T0 = 1_000_000_000_000

test('time left reads in days, hours and minutes', () => {
  expect(formatLeft(138 * MIN)).toBe('2h 18m')
  expect(formatLeft(7 * MIN)).toBe('7m')
  expect(formatLeft(-5_000)).toBe('0m')
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

// 3h 25m left of five hours: 1h 35m gone, the tick at about 32%.
const win = (over: Partial<Parameters<typeof strips>[0]>) => ({
  percent: 12,
  resetsAt: T0 + 205 * MIN,
  readAt: T0,
  week: null,
  ...over,
})

test('the 5h color follows the strip: green behind the tick, amber past it', () => {
  expect(fiveLevel(win({ percent: 25 }))).toBe('ok')
  expect(fiveLevel(win({ percent: 40 }))).toBe('watch')
})

test('48% with most of the window gone is calm, not red', () => {
  // The case that looked scary: 1h 29m left, so about 70% of the time is gone.
  expect(fiveLevel(win({ percent: 48, resetsAt: T0 + 89 * MIN }))).toBe('ok')
})

test('red only when little is left', () => {
  expect(fiveLevel(win({ percent: 84, resetsAt: T0 + 10 * MIN }))).toBe('ok')
  expect(fiveLevel(win({ percent: 85, resetsAt: T0 + 10 * MIN }))).toBe('hot')
})

test('the first half hour of a window never warns', () => {
  expect(fiveLevel(win({ percent: 8, resetsAt: T0 + 290 * MIN }))).toBe('ok')
})

test('the week color uses the same rule', () => {
  expect(weekLevel({ percent: 50, resetsAt: T0 + 5 * DAY, outIn: 2 * DAY })).toBe('watch')
  expect(weekLevel({ percent: 70, resetsAt: T0 + 2 * DAY, outIn: 10 * HOUR })).toBe('watch')
  expect(weekLevel({ percent: 90, resetsAt: T0 + 2 * DAY, outIn: 10 * HOUR })).toBe('hot')
  expect(weekLevel({ percent: 12, resetsAt: T0 + 6 * DAY, outIn: null })).toBe('ok')
  expect(weekLevel(null)).toBe('ok')
})

test('pill shows the percent in its color', () => {
  expect(pillSvg(12, 'ok')).toContain('>12%</tspan>')
  expect(pillSvg(40, 'watch')).toContain('#EF9F27')
})

test('each window is one strip: spent, time gone, its color and the reset', () => {
  const [five, week] = strips(win({ week: { percent: 13, resetsAt: T0 + 6 * DAY, outIn: null } }))
  expect(five?.label).toBe('5h')
  expect(Math.round((five?.spent ?? 0) * 100)).toBe(12)
  expect(Math.round((five?.elapsed ?? 0) * 300)).toBe(95)
  expect(five?.timer).toBe('3h 25m')
  expect(Math.round((week?.elapsed ?? 0) * 7 * 24)).toBe(24)
  expect(week?.timer).toBe('6d')
})

test('the 5h strip always takes the same color as the ring', () => {
  const w = win({ percent: 40 })
  const [five] = strips(w)
  expect(five?.level).toBe(fiveLevel(w))
  expect(stripSvg(five!)).toContain('#EF9F27')
})

test('a reading from an older version still draws', () => {
  const old = { percent: 6, resetsAt: null, readAt: T0, outIn: 5 * MIN } as unknown as Parameters<typeof strips>[0]
  expect(strips(old).length).toBe(1)
  expect(fiveLevel(old)).toBe('ok')
  expect(stripSvg(strips(old)[0]!)).not.toContain('width="2"')
  expect(cardText(old)).toBe('5h: 6% used')
})

test('spoken text names the reset', () => {
  expect(cardText(win({}))).toBe('5h: 12% used, resets in 3h 25m')
})
