import { signalBus } from './SignalBus'

class BehavioralCollector {
  private readonly handleMouseMove = (event: MouseEvent) => {
    signalBus.emit('behavioral', {
      type: 'mousemove',
      timestamp: Date.now(),
      x: event.clientX,
      y: event.clientY,
    })
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    signalBus.emit('behavioral', {
      type: 'keydown',
      timestamp: Date.now(),
      key: event.key,
    })
  }

  private readonly handleTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0]

    signalBus.emit('behavioral', {
      type: 'touchmove',
      timestamp: Date.now(),
      x: touch?.clientX,
      y: touch?.clientY,
    })
  }

  private active = false

  start(): void {
    if (this.active) {
      return
    }

    this.active = true
    window.addEventListener('mousemove', this.handleMouseMove, { passive: true })
    window.addEventListener('keydown', this.handleKeyDown, { passive: true })
    window.addEventListener('touchmove', this.handleTouchMove, { passive: true })
  }

  stop(): void {
    if (!this.active) {
      return
    }

    this.active = false
    window.removeEventListener('mousemove', this.handleMouseMove)
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('touchmove', this.handleTouchMove)
  }
}

export const behavioralCollector = new BehavioralCollector()
