import { useCamera } from '../hooks/useCamera'
import { useState } from 'react'

interface Props {
  onCapture: (b64: string) => void
  loading?: boolean
}

export function SelfieCapture({ onCapture, loading }: Props) {
  const { videoRef, ready, error, capture } = useCamera()
  const [captured, setCaptured] = useState<string | null>(null)

  function handleCapture() {
    const b64 = capture()
    if (b64) { setCaptured(b64); onCapture(b64) }
  }

  if (error) return (
    <div style={{ color: 'var(--red)', textAlign: 'center', padding: '20px' }}>
      {error}
    </div>
  )

  return (
    <div style={{ width: '100%' }}>
      <div style={{
        position: 'relative', width: '100%', maxWidth: 340, margin: '0 auto 20px',
        borderRadius: 12, overflow: 'hidden',
        border: `2px solid ${captured ? 'var(--green)' : 'var(--cyan)'}`,
        aspectRatio: '4/3', background: 'var(--bg3)'
      }}>
        <video
          ref={videoRef}
          autoPlay playsInline muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: captured ? 'none' : 'block' }}
        />
        {captured && (
          <img src={captured} alt="captured"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
        {!ready && !captured && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', color: 'var(--grey)'
          }}>
            Starting camera...
          </div>
        )}
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.6)', borderRadius: 20, padding: '3px 10px',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
          color: captured ? 'var(--green)' : 'var(--cyan)'
        }}>
          {captured ? '✓ CAPTURED' : 'LIVE'}
        </div>
      </div>

      {!captured ? (
        <button
          className="btn btn-primary"
          onClick={handleCapture}
          disabled={!ready || loading}
        >
          {loading ? 'Processing...' : 'Capture'}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={() => setCaptured(null)}>
            Retake
          </button>
          <button className="btn btn-primary" disabled={loading}>
            {loading ? 'Verifying...' : 'Confirmed'}
          </button>
        </div>
      )}
    </div>
  )
}
