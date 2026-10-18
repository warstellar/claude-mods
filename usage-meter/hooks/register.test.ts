import { expect, test } from 'claude-code/testing'

import { cardText, fiveAhead, fiveLevel, formatLeft, level, pace, pillSvg, pillWidth, cardSvg, paceGap, strips, weekLevel } from './register'

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

// 3h 25m left of five hours: 1h 35m gone, the tick at about 32%.
const win = (over: Partial<Parameters<typeof strips>[0]>) => ({
  percent: 12,
  resetsAt: T0 + 205 * MIN,
  readAt: T0,
  week: null,
  ...over,
})

test('green below 70, amber from 70, red from 90', () => {
  expect(level(69)).toBe('ok')
  expect(level(70)).toBe('watch')
  expect(level(89)).toBe('watch')
  expect(level(90)).toBe('hot')
})

test('the week uses the same thresholds', () => {
  expect(weekLevel({ percent: 24, resetsAt: T0 + 5 * DAY })).toBe('ok')
  expect(weekLevel({ percent: 75, resetsAt: T0 + 2 * DAY })).toBe('watch')
  expect(weekLevel(null)).toBe('ok')
})

test('pill shows the percent in its color', () => {
  expect(pillSvg(12, 'ok')).toContain('>12%</tspan>')
  expect(pillSvg(80, 'watch')).toContain('#EF9F27')
})

test('each window is one strip: spent, time gone, its color and the reset', () => {
  const [five, week] = strips(win({ week: { percent: 13, resetsAt: T0 + 6 * DAY } }))
  expect(five?.label).toBe('5h')
  expect(Math.round((five?.spent ?? 0) * 100)).toBe(12)
  expect(Math.round((five?.elapsed ?? 0) * 300)).toBe(95)
  expect(five?.timer).toBe('3h 25m')
  expect(Math.round((week?.elapsed ?? 0) * 7 * 24)).toBe(24)
  expect(week?.timer).toBe('6d')
})

test('the 5h strip always takes the same color as the ring', () => {
  const w = win({ percent: 80 })
  const [five] = strips(w)
  expect(five?.level).toBe(fiveLevel(w))
  expect(cardSvg([five!])).toContain('#EF9F27')
})

test('a reading from an older version still draws', () => {
  const old = { percent: 6, resetsAt: null, readAt: T0, outIn: 5 * MIN } as unknown as Parameters<typeof strips>[0]
  expect(strips(old).length).toBe(1)
  expect(fiveLevel(old)).toBe('ok')
  expect(cardSvg(strips(old))).not.toContain('<polygon')
  expect(cardText(old)).toBe('5h: 6% used')
})

test('spoken text names the reset', () => {
  expect(cardText(win({}))).toBe('5h: 12% used, resets in 3h 25m')
})

test('pace: ahead or behind only past a margin, and quiet early in a window', () => {
  expect(pace(0.4, 0.3, 0.1)).toBe('ahead')
  expect(pace(0.32, 0.3, 0.1)).toBe('on')
  expect(pace(0.2, 0.3, 0.1)).toBe('behind')
  expect(pace(0.08, 0.05, 0.1)).toBe(null)
  expect(pace(0.5, null, 0.1)).toBe(null)
})

test('the pill gets an arrow only when the 5h window races ahead', () => {
  // About 32% of the time gone.
  expect(fiveAhead(win({ percent: 45 }))).toBe(true)
  expect(fiveAhead(win({ percent: 30 }))).toBe(false)
  expect(pillSvg(45, 'ok', true)).toContain('<path')
  expect(pillSvg(45, 'ok')).not.toContain('<path')
  expect(pillWidth(45, true)).toBeGreaterThan(pillWidth(45))
})

test('the card spells out the pace of each window', () => {
  const [five, week] = strips(win({ percent: 10, week: { percent: 40, resetsAt: T0 + 5 * DAY } }))
  expect(five?.pace).toBe('behind')
  // Two days of seven gone, 40% spent.
  expect(week?.pace).toBe('ahead')
  expect(cardText(win({ percent: 45 }))).toContain('faster than the window')
})

test('the card shows how far ahead or behind each window is', () => {
  // About 32% of the five hours gone.
  const [ahead] = strips(win({ percent: 45 }))
  expect(paceGap(ahead!)).toBe(13)
  const svg = cardSvg([ahead!])
  expect(svg).toContain('+13%')
  expect(svg).toContain('#EF9F27')
  const [behind] = strips(win({ percent: 10 }))
  expect(cardSvg([behind!])).toContain('−22%')
  // On pace: the gauge, no number.
  const [even] = strips(win({ percent: 33 }))
  expect(even?.pace).toBe('on')
  expect(cardSvg([even!])).not.toMatch(/[+−]\d+%/)
})
