export type Window = { percent: number; resetsAt: number | null; readAt: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { window: Window | null }
  }
}
