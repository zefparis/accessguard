import { signalBus } from './SignalBus'

class FaceCollector {
  capture(frame: string): void {
    signalBus.emit('face', {
      frame,
      timestamp: Date.now(),
    })
  }
}

export const faceCollector = new FaceCollector()
