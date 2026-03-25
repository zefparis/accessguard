import { signalBus } from './SignalBus'

class BehavioralCollector {
  private lastTouch = 0

  private readonly handleMouseMove = (event: MouseEvent) => {
    signalBus.emit('behavioral', {
      type: 'mousemove',
      timestamp: Date.now(),
      x: event.clientX,
      y: event.clientY,
    })
  }

  private readonly handleKeyDown = () => {
    signalBus.emit('behavioral', {
      type: 'keydown',
      timestamp: Date.now(),
    })
  }

  private readonly handleTouchMove = (event: TouchEvent) => {
    const now = Date.now()
    if (now - this.lastTouch < 150) {
      return
    }

    this.lastTouch = now

    signalBus.emit('behavioral', {
      type: 'touchmove',
      timestamp: now,
      x: event.touches[0]?.clientX,
      y: event.touches[0]?.clientY,
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
