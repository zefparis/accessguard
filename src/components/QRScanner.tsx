import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

export type AccessQrPayload = {
  site: string
  zone: string
  access_point: string
}

function safeParseQr(data: string): AccessQrPayload | null {
  try {
    const parsed = JSON.parse(data) as Partial<AccessQrPayload>
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.site !== 'string') return null
    if (typeof parsed.zone !== 'string') return null
    if (typeof parsed.access_point !== 'string') return null
    return { site: parsed.site, zone: parsed.zone, access_point: parsed.access_point }
  } catch {
    return null
  }
}

export function QRScanner(props: {
  onDetected: (payload: AccessQrPayload) => void
  onError?: (message: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle')
  const rafRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let stopped = false

    async function start() {
      setStatus('starting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (stopped) return
        streamRef.current = stream
        const v = videoRef.current
        if (!v) return
        v.srcObject = stream
        await v.play()
        setStatus('scanning')
        tick()
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Camera error'
        setStatus('error')
        props.onError?.(msg)
      }
    }

    function successBeep() {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.type = 'sine'
        o.frequency.value = 880
        g.gain.value = 0.04
        o.connect(g)
        g.connect(ctx.destination)
        o.start()
        setTimeout(() => {
          o.stop()
          ctx.close().catch(() => undefined)
        }, 90)
      } catch {
        // ignore
      }
    }

    function tick() {
      const v = videoRef.current
      const c = canvasRef.current
      if (!v || !c) return

      const w = v.videoWidth
      const h = v.videoHeight
      if (w === 0 || h === 0) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }

      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.drawImage(v, 0, 0, w, h)
      const image = ctx.getImageData(0, 0, w, h)
      const code = jsQR(image.data, w, h, { inversionAttempts: 'attemptBoth' })
      if (code?.data) {
        const parsed = safeParseQr(code.data)
        if (parsed) {
          navigator.vibrate?.(50)
          successBeep()
          props.onDetected(parsed)
          return
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    start()

    return () => {
      stopped = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [props])

  return (
    <div style={{ width: '100%' }}>
      <div className="badge badge-cyan" style={{ margin: '0 auto 12px' }}>
        {status === 'starting' ? 'Starting camera…' : status === 'scanning' ? 'Scanning…' : status === 'error' ? 'Camera error' : 'Scanner'}
      </div>
      <div className="card" style={{ width: '100%', padding: 12 }}>
        <video ref={videoRef} style={{ width: '100%', borderRadius: 10 }} playsInline muted />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--grey)', lineHeight: 1.5 }}>
          Point the camera at the site QR code.
        </div>
      </div>
    </div>
  )
}
