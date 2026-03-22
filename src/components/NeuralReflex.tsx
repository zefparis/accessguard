import { useState, useEffect, useCallback } from 'react'

interface Props { onComplete: (velocityMs: number) => void }

export function NeuralReflex({ onComplete }: Props) {
  const ROUNDS = 6
  const [state, setState] = useState<'wait'|'ready'|'go'|'done'>('wait')
  const [idx, setIdx] = useState(0)
  const [times, setTimes] = useState<number[]>([])
  const [start, setStart] = useState(0)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (state !== 'ready') return
    const delay = 1500 + Math.random() * 2000
    const t = setTimeout(() => { setState('go'); setStart(Date.now()) }, delay)
    return () => clearTimeout(t)
  }, [state, idx])

  const handleTap = useCallback(() => {
    if (state === 'wait') { setState('ready'); return }
    if (state === 'ready') {
      setFeedback('Too early!')
      setTimeout(() => { setFeedback(null); setState('ready') }, 800)
      return
    }
    if (state === 'go') {
      const ms = Date.now() - start
      const newTimes = [...times, ms]
      setTimes(newTimes)
      setFeedback(`${ms}ms`)
      setTimeout(() => {
        setFeedback(null)
        if (idx + 1 >= ROUNDS) {
          const avg = Math.round(newTimes.reduce((a,b) => a+b, 0) / newTimes.length)
          setState('done')
          onComplete(avg)
        } else {
          setIdx(i => i + 1)
          setState('ready')
        }
      }, 600)
    }
  }, [state, start, times, idx, onComplete])

  const bg = state === 'go' ? 'var(--green)' : state === 'ready' ? '#1a2236' : 'var(--bg3)'
  const label = state === 'wait' ? 'TAP TO START' : state === 'ready' ? 'WAIT...' : state === 'go' ? 'TAP NOW!' : 'DONE'

  return (
    <div style={{ textAlign: 'center', width: '100%' }}>
      <div className="badge badge-cyan" style={{ margin: '0 auto 20px' }}>
        Neural Reflex — {Math.min(idx + 1, ROUNDS)}/{ROUNDS}
      </div>
      <p style={{ fontSize: 13, color: 'var(--grey)', marginBottom: 24 }}>
        Tap as fast as possible when the button turns <b style={{ color: 'var(--green)' }}>GREEN</b>
      </p>
      <button onClick={handleTap} style={{
        width: '100%', height: 160, borderRadius: 16,
        background: bg, border: `2px solid ${state === 'go' ? 'var(--green)' : 'var(--border)'}`,
        color: state === 'go' ? '#fff' : 'var(--grey)',
        fontSize: feedback ? 36 : 18, fontWeight: 800,
        cursor: 'pointer', transition: 'all 0.15s', letterSpacing: 3
      }}>
        {feedback || label}
      </button>
      {times.length > 0 && (
        <p style={{ marginTop: 16, fontSize: 13, color: 'var(--grey)' }}>
          Avg: {Math.round(times.reduce((a,b) => a+b, 0) / times.length)}ms
        </p>
      )}
    </div>
  )
}
