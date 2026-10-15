export type Sample = { at: number; percent: number }

export type Week = {
  percent: number
  resetsAt: number | null
  outIn: number | null
}

export type Window = {
  percent: number
  resetsAt: number | null
  readAt: number
  outIn: number | null
  week: Week | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { window: Window | null }
  }
}
