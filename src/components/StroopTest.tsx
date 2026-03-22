import { useState, useCallback } from 'react'

interface Props { onComplete: (score: number) => void }

const COLORS = ['RED','GREEN','BLUE','YELLOW','PURPLE']
const HEX: Record<string,string> = {
  RED:'#ef4444', GREEN:'#22c55e', BLUE:'#3b82f6', YELLOW:'#f59e0b', PURPLE:'#a855f7'
}

function makeRound() {
  const word  = COLORS[Math.floor(Math.random()*COLORS.length)]
  let   color = COLORS[Math.floor(Math.random()*COLORS.length)]
  const congruent = Math.random() > 0.5
  if (congruent) color = word
  else while (color === word) color = COLORS[Math.floor(Math.random()*COLORS.length)]
  return { word, color, correct: color }
}

export function StroopTest({ onComplete }: Props) {
  const ROUNDS = 8
  const [round, setRound] = useState(makeRound())
  const [score, setScore] = useState(0)
  const [idx, setIdx] = useState(0)
  const [feedback, setFeedback] = useState<string | null>(null)

  const answer = useCallback((picked: string) => {
    const correct = picked === round.correct
    if (correct) setScore(s => s + 1)
    setFeedback(correct ? '✓' : '✗')
    setTimeout(() => {
      setFeedback(null)
      if (idx + 1 >= ROUNDS) {
        onComplete(Math.round((score + (correct ? 1 : 0)) / ROUNDS * 100))
      } else {
        setIdx(i => i + 1)
        setRound(makeRound())
      }
    }, 400)
  }, [round, idx, score, onComplete])

  return (
    <div style={{ textAlign: 'center', width: '100%' }}>
      <div className="badge badge-cyan" style={{ margin: '0 auto 20px' }}>
        Stroop Test — {idx + 1}/{ROUNDS}
      </div>
      <p style={{ fontSize: 13, color: 'var(--grey)', marginBottom: 24 }}>
        Select the <b style={{ color: 'var(--white)' }}>INK COLOR</b> of the word — ignore what it says
      </p>
      <div style={{
        fontSize: 52, fontWeight: 800, marginBottom: 32,
        color: HEX[round.color], letterSpacing: 2,
        minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {feedback ? <span style={{ fontSize: 48 }}>{feedback}</span> : round.word}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {COLORS.map(c => (
          <button key={c} className="btn btn-outline"
            onClick={() => answer(c)} disabled={!!feedback}
            style={{ borderColor: HEX[c], color: HEX[c] }}>
            {c}
          </button>
        ))}
      </div>
    </div>
  )
}
