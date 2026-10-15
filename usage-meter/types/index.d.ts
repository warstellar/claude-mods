export type Week = {
  percent: number
  resetsAt: number | null
}

export type Window = {
  percent: number
  resetsAt: number | null
  readAt: number
  week: Week | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { window: Window | null }
  }
}
