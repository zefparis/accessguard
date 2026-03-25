import { useEffect, useState } from 'react'

interface Props {
  isLoading: boolean
  onLoadingComplete?: () => void
}

export function CameraInitLoader({ isLoading, onLoadingComplete }: Props) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Initializing camera...')
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    if (!isLoading) {
      setProgress(0)
      setStatus('Initializing camera...')
      setFadeOut(false)
      return
    }

    setProgress(0)
    setStatus('Initializing camera...')
    setFadeOut(false)

    const startTime = Date.now()
    const duration = 2000 // 2 seconds

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const currentProgress = Math.min((elapsed / duration) * 100, 100)

      setProgress(currentProgress)

      // Update status based on progress
      if (currentProgress < 33) {
        setStatus('Initializing camera...')
      } else if (currentProgress < 66) {
        setStatus('Connecting to recognition service...')
      } else {
        setStatus('Ready')
      }

      // When complete, fade out and call callback
      if (currentProgress >= 100) {
        clearInterval(interval)
        setFadeOut(true)
        setTimeout(() => {
          onLoadingComplete?.()
        }, 500) // Wait for fade out animation
      }
    }, 16) // ~60fps

    return () => clearInterval(interval)
  }, [isLoading, onLoadingComplete])

  if (!isLoading && !fadeOut) {
    return null
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10, 15, 30, 0.95)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 0.5s ease-out',
        pointerEvents: fadeOut ? 'none' : 'auto',
      }}
    >
      <div style={{ width: '100%', maxWidth: 300, padding: '0 20px' }}>
        {/* Progress Bar */}
        <div
          style={{
            width: '100%',
            height: 4,
            background: 'var(--border)',
            borderRadius: 2,
            marginBottom: 24,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              background: 'var(--green)',
              borderRadius: 2,
              width: `${progress}%`,
              transition: 'width 0.1s linear',
            }}
          />
        </div>

        {/* Status Message */}
        <div
          style={{
            textAlign: 'center',
            fontSize: 14,
            color: 'var(--grey)',
            fontWeight: 500,
            letterSpacing: '0.05em',
            transition: 'opacity 0.3s ease',
          }}
        >
          {status}
        </div>

        {/* Progress Percentage */}
        <div
          style={{
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--green)',
            marginTop: 12,
            fontWeight: 600,
            opacity: 0.7,
          }}
        >
          {Math.round(progress)}%
        </div>
      </div>
    </div>
  )
}
