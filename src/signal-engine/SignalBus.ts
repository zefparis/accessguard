type Listener = (data: unknown) => void

class SignalBus {
  private readonly listeners = new Map<string, Set<Listener>>()
  private paused = false

  emit(channel: string, data: unknown): void {
    if (this.paused) return
    const subs = this.listeners.get(channel)
    if (subs) {
      for (const fn of subs) {
        try { fn(data) } catch { /* swallow */ }
      }
    }
  }

  subscribe(channel: string, fn: Listener): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set())
    }
    this.listeners.get(channel)!.add(fn)
    return () => { this.listeners.get(channel)?.delete(fn) }
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }
}

export const signalBus = new SignalBus()
