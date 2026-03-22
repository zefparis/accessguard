import { useState, useEffect, useCallback } from 'react'

interface Props { onComplete: (avgMs: number) => void }

export function ReactionTime({ onComplete }: Props) {
  const ROUNDS = 5
  const [idx, setIdx] = useState(0)
  const [active, setActive] = useState(false)
  const [started, setStarted] = useState(false)
  const [t0, setT0] = useState(0)
  const [times, setTimes] = useState<number[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!started || active) return
    const delay = 1000 + Math.random() * 3000
    const timer = setTimeout(() => { setActive(true); setT0(Date.now()) }, delay)
    return () => clearTimeout(timer)
  }, [started, active, idx])

  const tap = useCallback(() => {
    if (!started) { setStarted(true); return }
    if (!active) {
      setFeedback('Too early — wait for YELLOW')
      setTimeout(() => setFeedback(null), 800)
      return
    }
    const ms = Date.now() - t0
    const next = [...times, ms]
    setTimes(next)
    setActive(false)
    setFeedback(`${ms}ms`)
    setTimeout(() => {
      setFeedback(null)
      if (idx + 1 >= ROUNDS) {
        onComplete(Math.round(next.reduce((a,b) => a+b,0)/next.length))
      } else {
        setIdx(i => i+1)
      }
    }, 700)
  }, [started, active, t0, times, idx, onComplete])

  return (
    <div style={{ textAlign: 'center', width: '100%' }}>
      <div className="badge badge-cyan" style={{ margin: '0 auto 20px' }}>
        Reaction Time — {Math.min(idx+1, ROUNDS)}/{ROUNDS}
      </div>
      <p style={{ fontSize: 13, color: 'var(--grey)', marginBottom: 24 }}>
        Tap immediately when the target turns <b style={{ color: 'var(--amber)' }}>YELLOW</b>
      </p>
      <button onClick={tap} style={{
        width: '100%', height: 140, borderRadius: 16,
        background: active ? 'var(--amber)' : started ? 'var(--bg3)' : 'var(--bg3)',
        border: `2px solid ${active ? 'var(--amber)' : 'var(--border)'}`,
        color: active ? '#000' : 'var(--grey)',
        fontSize: feedback ? 34 : 17, fontWeight: 800,
        cursor: 'pointer', transition: 'all 0.1s', letterSpacing: 2
      }}>
        {feedback || (active ? 'TAP!' : started ? 'WAITING...' : 'TAP TO START')}
      </button>
      {times.length > 0 && (
        <p style={{ marginTop: 14, fontSize: 13, color: 'var(--grey)' }}>
          Best: {Math.min(...times)}ms
        </p>
      )}
    </div>
  )
}
