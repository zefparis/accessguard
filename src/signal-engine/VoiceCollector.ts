import { signalBus } from './SignalBus'

class VoiceCollector {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null

  async start(): Promise<void> {
    if (this.recorder?.state === 'recording') {
      return
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size === 0) {
        return
      }

      signalBus.emit('voice', {
        chunk: event.data,
        timestamp: Date.now(),
      })
    }
    this.recorder.start(1000)
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop()
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
    }

    this.recorder = null
    this.stream = null
  }
}

export const voiceCollector = new VoiceCollector()
