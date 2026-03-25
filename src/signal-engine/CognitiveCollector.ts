import { signalBus } from './SignalBus'

class CognitiveCollector {
  record(result: { testId: string; score: number; durationMs: number }): void {
    signalBus.emit('cognitive', {
      ...result,
      timestamp: Date.now(),
    })
  }
}

export const cognitiveCollector = new CognitiveCollector()
