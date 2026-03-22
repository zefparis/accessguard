import { useEffect, useMemo, useRef, useState } from 'react'
import { useVoiceBiometrics } from '../hooks/useVoiceBiometrics'

interface Props {
  onComplete: (result: { embedding: number[]; quality: number; threshold: number }) => void
}

const PROMPTS = [
  { type: 'letter', prompt: 'Say the letter:', value: 'B' },
  { type: 'color', prompt: 'Name this color:', value: 'BLUE', color: '#3b82f6' },
  { type: 'math', prompt: 'Say the answer:', value: '7 + 5 = ?' },
]

const ENROLL_ROUNDS = 3
const ROUND_MS = 2000
const THRESHOLD = 0.75

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function rms(arr: Float32Array): number {
  let s = 0
  for (let i = 0; i < arr.length; i += 1) s += arr[i] * arr[i]
  return arr.length ? Math.sqrt(s / arr.length) : 0
}

export function VocalImprint({ onComplete }: Props) {
  const { isRecording, countdownMs, waveform, recordAudio, extractMFCC } = useVoiceBiometrics()

  const [round, setRound] = useState(0)
  const [qualities, setQualities] = useState<number[]>([])
  const [embeddings, setEmbeddings] = useState<Float32Array[]>([])
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const prompt = useMemo(() => PROMPTS[round % PROMPTS.length], [round])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !waveform) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width, height } = canvas
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(34,197,94,0.06)'
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(34,197,94,0.9)'
    ctx.lineWidth = 2
    ctx.beginPath()

    const slice = Math.max(1, Math.floor(waveform.length / width))
    let x = 0
    for (let i = 0; i < waveform.length; i += slice) {
      const v = (waveform[i] - 128) / 128 // [-1..1]
      const y = height / 2 + v * (height * 0.35)
      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
      x += 1
      if (x >= width) break
    }
    ctx.stroke()
  }, [waveform])

  async function runRound() {
    setError(null)
    try {
      const samples = await recordAudio(ROUND_MS)
      const emb = extractMFCC(samples, 16000)

      const q = clamp01((rms(samples) - 0.01) / 0.1)
      setQualities(prev => [...prev, q])
      setEmbeddings(prev => [...prev, emb])

      const next = round + 1
      if (next >= ENROLL_ROUNDS) {
        // average embeddings
        const dim = emb.length
        const avg = new Float32Array(dim)
        for (const e of [...embeddings, emb]) {
          for (let i = 0; i < dim; i += 1) avg[i] += e[i]
        }
        for (let i = 0; i < dim; i += 1) avg[i] /= ENROLL_ROUNDS

        // normalize
        let norm = 0
        for (let i = 0; i < dim; i += 1) norm += avg[i] * avg[i]
        norm = Math.sqrt(norm) || 1
        for (let i = 0; i < dim; i += 1) avg[i] /= norm

        const qualityAvg = [...qualities, q].reduce((a, b) => a + b, 0) / ENROLL_ROUNDS
        setDone(true)
        onComplete({ embedding: Array.from(avg), quality: qualityAvg, threshold: THRESHOLD })
      } else {
        setRound(next)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone recording failed')
    }
  }

  const secondsLeft = Math.ceil(countdownMs / 1000)

  return (
    <div style={{ textAlign: 'center', width: '100%' }}>
      <div className="badge badge-cyan" style={{ margin: '0 auto 20px' }}>
        Vocal Imprint — Round {Math.min(round + 1, ENROLL_ROUNDS)}/{ENROLL_ROUNDS}
      </div>

      <p style={{ fontSize: 13, color: 'var(--grey)', marginBottom: 18 }}>
        {done
          ? 'Voice registered ✓'
          : 'Allow microphone access. Speak naturally, in a quiet environment.'}
      </p>

      {!done && (
        <>
          <div style={{
            fontSize: prompt.type === 'math' ? 32 : 64,
            fontWeight: 800,
            color: prompt.color || 'var(--cyan)',
            marginBottom: 18,
            minHeight: 90,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}>
            {prompt.type === 'color' ? '' : prompt.value}
            {prompt.type === 'color' && (
              <div style={{ width: 70, height: 70, borderRadius: 12, background: prompt.color }} />
            )}
          </div>

          <div style={{
            width: '100%',
            maxWidth: 440,
            margin: '0 auto 16px',
            padding: 10,
            borderRadius: 12,
            border: '1px solid rgba(34,197,94,0.18)',
            background: 'rgba(0,0,0,0.16)',
          }}>
            <canvas ref={canvasRef} width={420} height={80} style={{ width: '100%', height: 80 }} />
            <div style={{
              marginTop: 8,
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              color: 'var(--grey)',
            }}>
              <span>{prompt.prompt}</span>
              <span>{isRecording ? `Recording... ${secondsLeft}s` : 'Ready'}</span>
            </div>
          </div>

          <button
            className={`btn ${isRecording ? 'btn-danger' : 'btn-primary'}`}
            onClick={runRound}
            disabled={isRecording}
          >
            {isRecording ? '● Recording...' : 'Record 2s'}
          </button>

          {qualities.length > 0 && (
            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--grey)' }}>
              {qualities.map((q, i) => (
                <div key={i}>
                  Round {i + 1} quality: <b style={{ color: 'var(--green)' }}>{Math.round(q * 100)}%</b>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div style={{ marginTop: 14, fontSize: 12, color: 'var(--red)' }}>
              {error}
            </div>
          )}
        </>
      )}

      {done && (
        <div style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 10,
          border: '1px solid rgba(34,197,94,0.25)',
          background: 'rgba(34,197,94,0.08)',
          color: 'var(--grey)',
          fontSize: 12,
        }}>
          Voice imprint stored (embedding: 192-dim). Threshold: {THRESHOLD}
        </div>
      )}
    </div>
  )
}
