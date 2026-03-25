class SignalBus {
  private readonly buffers = new Map<string, unknown[]>()

  constructor() {
    window.setInterval(() => {
      for (const [channel, buffer] of this.buffers.entries()) {
        if (buffer.length === 0) {
          continue
        }

        const batch = [...buffer]
        this.buffers.set(channel, [])
        this.sendToBackend(channel, batch)
      }
    }, 300)
  }

  emit(channel: string, data: unknown): void {
    const current = this.buffers.get(channel) ?? []
    current.push(data)
    this.buffers.set(channel, current)
  }

  private sendToBackend(channel: string, batch: unknown[]): void {
    void fetch('/api/signals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        batch,
        source: 'accessguard',
      }),
    }).catch(() => {})
  }
}

export const signalBus = new SignalBus()
