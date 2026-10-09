export type Snapshot = { tokens: number | null; window: number }

declare module 'claude-code' {
  interface PluginState {
    'context-meter': { snapshot: Snapshot | null; isCompacting: boolean }
  }
}
