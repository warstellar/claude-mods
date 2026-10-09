export type Sample = { at: number; percent: number }

export type Window = {
  percent: number
  resetsAt: number | null
  readAt: number
  outIn: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { window: Window | null }
  }
}
