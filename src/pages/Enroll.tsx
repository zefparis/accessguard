import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelfieCapture } from '../components/SelfieCapture'
import { StroopTest } from '../components/StroopTest'
import { BehavioralCapture } from '../components/BehavioralCapture'
import type { BehavioralController, BehavioralProfile } from '../hooks/useBehavioral'
import { useVoiceBiometrics } from '../hooks/useVoiceBiometrics'
import { useAccessGuardStore } from '../store/accessguardStore'
import { enrollWorker, vocalVerify } from '../services/api'
import { generateSessionKeypair, PQ_ALGORITHM, signProfile } from '../services/postQuantum'
import { behavioralCollector, faceCollector, signalBus } from '../signal-engine'
import type { CognitiveBaseline } from '../types'

type Step = 'identity' | 'selfie' | 'stroop' | 'vocal' | 'reflex' | 'submitting' | 'success' | 'error'

type VocalPhase = 'idle' | 'recording' | 'processing' | 'done'

const PROGRESS: Record<Step, number> = {
  identity:10, selfie:25, stroop:40, vocal:60, reflex:80, submitting:95, success:100, error:0
}

const VOCAL_RECORD_MS = 3000
const REFLEX_ROUNDS = 5

type IdentityFormState = {
  firstName: string
  lastName: string
  employeeId: string
  accessLevel: 'Visitor' | 'Staff' | 'Manager' | 'Security'
  siteZone: string
  company: string
  email: string
}

type IdentityFormProps = {
  form: IdentityFormState
  onSubmit: (e: FormEvent) => void
  onFirstNameChange: (e: ChangeEvent<HTMLInputElement>) => void
  onLastNameChange: (e: ChangeEvent<HTMLInputElement>) => void
  onEmployeeIdChange: (e: ChangeEvent<HTMLInputElement>) => void
  onAccessLevelChange: (e: ChangeEvent<HTMLSelectElement>) => void
  onSiteZoneChange: (e: ChangeEvent<HTMLInputElement>) => void
  onCompanyChange: (e: ChangeEvent<HTMLInputElement>) => void
  onEmailChange: (e: ChangeEvent<HTMLInputElement>) => void
}

const IdentityForm = memo(function IdentityForm({
  form,
  onSubmit,
  onFirstNameChange,
  onLastNameChange,
  onEmployeeIdChange,
  onAccessLevelChange,
  onSiteZoneChange,
  onCompanyChange,
  onEmailChange,
}: IdentityFormProps) {
  return (
    <>
      <div className="badge badge-cyan">Step 1 of 5 — Identity</div>
      <h1 className="step-title">Access Registration</h1>
      <p className="step-sub">Create your physical access profile for secure sites.</p>
      <form onSubmit={onSubmit} style={{ width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>First Name *</label>
            <input value={form.firstName} onChange={onFirstNameChange} required placeholder="John" />
          </div>
          <div className="field">
            <label>Last Name *</label>
            <input value={form.lastName} onChange={onLastNameChange} required placeholder="Smith" />
          </div>
        </div>
        <div className="field">
          <label>Employee ID</label>
          <input value={form.employeeId} onChange={onEmployeeIdChange} placeholder="EMP-001" />
        </div>
        <div className="field">
          <label>Access Level *</label>
          <select value={form.accessLevel} onChange={onAccessLevelChange} required>
            <option value="Visitor">Visitor</option>
            <option value="Staff">Staff</option>
            <option value="Manager">Manager</option>
            <option value="Security">Security</option>
          </select>
        </div>
        <div className="field">
          <label>Site / Zone *</label>
          <input value={form.siteZone} onChange={onSiteZoneChange} required placeholder="Zone B — Restricted" />
        </div>
        <div className="field">
          <label>Company *</label>
          <input value={form.company} onChange={onCompanyChange} required placeholder="ACME Mining" />
        </div>
        <div className="field">
          <label>Email (optional)</label>
          <input value={form.email} onChange={onEmailChange} placeholder="your email (optional)" type="email" />
        </div>
        <button className="btn btn-primary" type="submit">
          Continue →
        </button>
      </form>
    </>
  )
})

export function Enroll() {
  const nav = useNavigate()
  const { setWorker, setSelfie, setCognitive } = useAccessGuardStore()

  useEffect(() => {
    behavioralCollector.start()

    return () => {
      behavioralCollector.stop()
    }
  }, [])

  const [step, setStep] = useState<Step>('identity')
  const [selfieB64, setSelfieB64] = useState('')
  const [cognitive, setCog] = useState<Partial<CognitiveBaseline>>({})
  const [errorMsg, setErrorMsg] = useState('')
  const [workerId, setWorkerId] = useState('')
  const [confidence, setConf] = useState(0)

  const voice = useVoiceBiometrics()
  const [vocalPhase, setVocalPhase] = useState<VocalPhase>('idle')

  // Reflex state
  const [reflexRound, setReflexRound] = useState(0)
  const [reflexState, setReflexState] = useState<'wait' | 'ready' | 'go'>('wait')
  const [reflexTimes, setReflexTimes] = useState<number[]>([])
  const [reflexT0, setReflexT0] = useState(0)
  const [reflexFeedback, setReflexFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (step === 'selfie') {
      signalBus.pause()

      return () => {
        signalBus.resume()
      }
    }

    signalBus.resume()
  }, [step])

  const behavioralCtrlRef = useRef<BehavioralController | null>(null)
  const [behavioralProfile, setBehavioralProfile] = useState<BehavioralProfile | null>(null)
  const [pqPublicKey, setPqPublicKey] = useState<string | null>(null)
  const [pqSignature, setPqSignature] = useState<string | null>(null)

  const deviceType = useMemo(() => behavioralProfile?.device.device_type ?? 'unknown', [behavioralProfile])

  const behavioralCaptured = useMemo(() => Boolean(behavioralProfile), [behavioralProfile])
  const pqCaptured = useMemo(() => Boolean(pqPublicKey && pqSignature), [pqPublicKey, pqSignature])

  const [form, setForm] = useState<IdentityFormState>({
    firstName: '',
    lastName: '',
    employeeId: '',
    accessLevel: 'Staff' as 'Visitor' | 'Staff' | 'Manager' | 'Security',
    siteZone: '',
    company: '',
    email: '',
  })

  const handleFirstNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, firstName: e.target.value }))
  }, [])

  const handleLastNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, lastName: e.target.value }))
  }, [])

  const handleEmployeeIdChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, employeeId: e.target.value }))
  }, [])

  const handleAccessLevelChange = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    setForm(f => ({ ...f, accessLevel: e.target.value as IdentityFormState['accessLevel'] }))
  }, [])

  const handleSiteZoneChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, siteZone: e.target.value }))
  }, [])

  const handleCompanyChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, company: e.target.value }))
  }, [])

  const handleEmailChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(f => ({ ...f, email: e.target.value }))
  }, [])

  const handleIdentity = useCallback((e: FormEvent) => {
    e.preventDefault()
    if (!form.firstName || !form.lastName || !form.company || !form.siteZone) return
    setStep('selfie')
  }, [form.company, form.firstName, form.lastName, form.siteZone])

  function handleSelfie(b64: string) {
    faceCollector.capture(b64)
    // Strip data URL prefix — backend expects raw base64
    const raw = b64.replace(/^data:image\/[a-z]+;base64,/, '')
    setSelfieB64(raw)
    setTimeout(() => setStep('stroop'), 600)
  }

  function handleStroop(score: number) {
    setCog(c => ({ ...c, stroopScore: score, stroopAccuracy: score / 100 }))
    setStep('vocal')
  }

  async function handleVocalStart() {
    setVocalPhase('recording')
    let samples: Float32Array
    try {
      samples = await voice.recordAudio(VOCAL_RECORD_MS)
    } catch (e) {
      console.error('[vocal] recordAudio failed', e)
      setCog(c => ({ ...c, vocalAccuracy: 0, vocalQuality: 0 }))
      setVocalPhase('idle')
      setStep('reflex')
      return
    }

    if (!samples || samples.length === 0) {
      setCog(c => ({ ...c, vocalAccuracy: 0, vocalQuality: 0 }))
      setVocalPhase('idle')
      setStep('reflex')
      return
    }

    setVocalPhase('processing')
    const embedding = voice.extractMFCC(samples, 16000)

    let quality = 0
    try {
      const resp = await vocalVerify({
        first_name: form.firstName,
        last_name: form.lastName,
        vocal_embedding: Array.from(embedding),
      })
      quality = Math.max(0, Math.min(1, resp.vocal_score))
    } catch { /* continue without voice */ }

    setCog(c => ({
      ...c,
      vocalAccuracy: Math.round(quality * 100),
      vocalEmbedding: Array.from(embedding),
      vocalQuality: quality,
      vocalSimilarityThreshold: 0.75,
    }))

    setVocalPhase('done')
    await new Promise(r => setTimeout(r, 800))
    setVocalPhase('idle')
    setStep('reflex')
  }

  // ── Reflex handlers ──
  useEffect(() => {
    if (step !== 'reflex' || reflexState !== 'ready') return
    const delay = 800 + Math.random() * 1200
    const timer = setTimeout(() => { setReflexState('go'); setReflexT0(Date.now()) }, delay)
    return () => clearTimeout(timer)
  }, [step, reflexState, reflexRound])

  function handleReflexTap() {
    if (reflexState === 'wait') { setReflexState('ready'); return }
    if (reflexState === 'ready') {
      setReflexFeedback('Too early!')
      setTimeout(() => setReflexFeedback(null), 600)
      return
    }
    if (reflexState === 'go') {
      const ms = Date.now() - reflexT0
      const next = [...reflexTimes, ms]
      setReflexTimes(next)
      setReflexFeedback(`${ms}ms`)
      setTimeout(() => {
        setReflexFeedback(null)
        if (reflexRound + 1 >= REFLEX_ROUNDS) {
          const avg = Math.round(next.reduce((a, b) => a + b, 0) / next.length)
          setCog(c => ({ ...c, reflexAvgMs: avg, reflexScores: next, reflexVelocityMs: avg }))
          submitEnrollment(next)
        } else {
          setReflexRound(r => r + 1)
          setReflexState('ready')
        }
      }, 500)
    }
  }

  const onBehavioralController = useCallback((controller: BehavioralController) => {
    behavioralCtrlRef.current = controller
  }, [])

  async function submitEnrollment(scores?: number[]) {
    const reflexScoresArr = scores ?? reflexTimes
    const reflexAvg = reflexScoresArr.length
      ? Math.round(reflexScoresArr.reduce((a, b) => a + b, 0) / reflexScoresArr.length)
      : 0

    const final: CognitiveBaseline = {
      stroopScore: cognitive.stroopScore ?? 0,
      stroopAccuracy: cognitive.stroopScore ? (cognitive.stroopScore / 100) : 0,
      reflexVelocityMs: reflexAvg,
      reflexAvgMs: reflexAvg,
      reflexScores: reflexScoresArr,
      vocalAccuracy: cognitive.vocalAccuracy ?? 0,
      vocalEmbedding: cognitive.vocalEmbedding,
      vocalQuality: cognitive.vocalQuality,
      vocalSimilarityThreshold: cognitive.vocalSimilarityThreshold ?? 0.75,
      reactionTimeMs: reflexAvg,
    }
    setCog(final)
    setStep('submitting')

    try {
      const behavioral = behavioralCtrlRef.current?.stop()
      if (behavioral) setBehavioralProfile(behavioral)

      const cognitiveBaseline = {
        stroop_score: final.stroopScore / 100,
        stroop_accuracy: final.stroopAccuracy,
        reflex_avg_ms: final.reflexAvgMs,
        reflex_scores: final.reflexScores,
        reflex_velocity_ms: final.reflexVelocityMs,
        vocal_accuracy: final.vocalAccuracy / 100,
        reaction_time_ms: final.reactionTimeMs,
        vocal_embedding: final.vocalEmbedding,
        vocal_quality: final.vocalQuality,
        vocal_similarity_threshold: final.vocalSimilarityThreshold,
        behavioral,
      }

      const { publicKey: pq_public_key, privateKey } = generateSessionKeypair()
      const pq_signature = signProfile(cognitiveBaseline, privateKey)
      setPqPublicKey(pq_public_key)
      setPqSignature(pq_signature)

      const payloadBaseline = {
        ...cognitiveBaseline,
        pq_public_key,
        pq_signature,
        pq_algorithm: PQ_ALGORITHM,
      }

      console.log('[ENROLL PAYLOAD]', {
        stroopScore: final.stroopScore,
        stroopAccuracy: final.stroopAccuracy,
        reflexAvgMs: final.reflexAvgMs,
        reflexScores: final.reflexScores,
        vocalQuality: final.vocalQuality,
        hasEmbedding: !!(final.vocalEmbedding && final.vocalEmbedding.length > 0),
        selfieB64Length: selfieB64.length,
        selfieB64Prefix: selfieB64.substring(0, 30),
      })

      const res = await enrollWorker({
        selfie_b64: selfieB64,
        first_name: form.firstName,
        last_name: form.lastName,
        email: form.email || `${form.firstName}.${form.lastName}@accessguard.local`,
        tenant_id: import.meta.env.VITE_TENANT_ID,
        cognitive_baseline: payloadBaseline,
      })
      setWorkerId(res.student_id)
      setConf(Math.round(res.confidence))
      setWorker({
        workerId: res.student_id,
        firstName: form.firstName,
        lastName: form.lastName,
        employeeId: form.employeeId,
        jobRole: form.accessLevel,
        employerSite: `${form.company} — ${form.siteZone}`,
        tenantId: import.meta.env.VITE_TENANT_ID,
        cognitiveBaseline: final,
      })
      setSelfie(selfieB64)
      setCognitive(final)
      setStep('success')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Enrollment failed')
      setStep('error')
    }
  }

  return (
    <BehavioralCapture enabled={step !== 'identity'} onController={onBehavioralController}>
      <div className="page">
        <div className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>← ACCESSGUARD</div>

        <div className="progress-bar" style={{ width: '100%', maxWidth: 440 }}>
          <div className="progress-fill" style={{ width: `${PROGRESS[step]}%` }} />
        </div>

        {step === 'identity' && (
          <IdentityForm
            form={form}
            onSubmit={handleIdentity}
            onFirstNameChange={handleFirstNameChange}
            onLastNameChange={handleLastNameChange}
            onEmployeeIdChange={handleEmployeeIdChange}
            onAccessLevelChange={handleAccessLevelChange}
            onSiteZoneChange={handleSiteZoneChange}
            onCompanyChange={handleCompanyChange}
            onEmailChange={handleEmailChange}
          />
        )}

        {step === 'selfie' && (
        <>
          <div className="badge badge-cyan">Step 2 of 5 — Biometric</div>
          <h1 className="step-title">Face Registration</h1>
          <p className="step-sub">Look directly at the camera. Ensure good lighting.</p>
          <SelfieCapture onCapture={handleSelfie} />
        </>
        )}

        {step === 'stroop' && (
        <>
          <div className="badge badge-amber">Step 3 of 5 — Cognitive</div>
          <h1 className="step-title">Stroop Test</h1>
          <StroopTest onComplete={handleStroop} />
        </>
        )}

        {step === 'vocal' && (
        <>
          <div className="badge badge-amber">Step 4 of 5 — Voice sample</div>
          <h1 className="step-title">Vocal Imprint</h1>
          <p className="step-sub">
            Read this sentence aloud when recording starts:
            <br />
            <em style={{ color: 'var(--ink, #fff)' }}>"I confirm my access registration."</em>
          </p>

          {vocalPhase === 'idle' && (
            <button className="btn btn-primary" type="button" onClick={handleVocalStart}>
              Start Recording
            </button>
          )}

          {vocalPhase === 'recording' && (
            <div className="card" style={{ textAlign: 'center', padding: '24px 12px' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--cyan, #06b6d4)' }}>
                Recording... (3s)
              </p>
            </div>
          )}

          {vocalPhase === 'processing' && (
            <div className="card" style={{ textAlign: 'center', padding: '24px 12px' }}>
              <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--grey)' }}>
                Processing...
              </p>
            </div>
          )}

          {vocalPhase === 'done' && (
            <div className="card" style={{ textAlign: 'center', padding: '24px 12px' }}>
              <p style={{ fontSize: 20, fontWeight: 800, color: 'var(--green, #22c55e)' }}>
                Done ✓
              </p>
            </div>
          )}
        </>
        )}

        {step === 'reflex' && (
        <>
          <div className="badge badge-amber">Step 5 of 5 — Reflex</div>
          <h1 className="step-title">Reflex Test</h1>
          <p className="step-sub">
            Tap immediately when the button turns <b style={{ color: 'var(--green, #22c55e)' }}>GREEN</b>.
            {' '}{Math.min(reflexRound + 1, REFLEX_ROUNDS)}/{REFLEX_ROUNDS}
          </p>
          <button
            onClick={handleReflexTap}
            style={{
              width: '100%', height: 140, borderRadius: 16,
              background: reflexState === 'go' ? 'var(--green, #22c55e)' : 'var(--bg3, #1a2236)',
              border: `2px solid ${reflexState === 'go' ? 'var(--green, #22c55e)' : 'var(--border, #333)'}`,
              color: reflexState === 'go' ? '#fff' : 'var(--grey)',
              fontSize: reflexFeedback ? 32 : 18, fontWeight: 800,
              cursor: 'pointer', transition: 'all 0.1s', letterSpacing: 2,
            }}
          >
            {reflexFeedback || (reflexState === 'go' ? 'TAP NOW!' : reflexState === 'ready' ? 'WAIT...' : 'TAP TO START')}
          </button>
          {reflexTimes.length > 0 && (
            <p style={{ marginTop: 14, fontSize: 13, color: 'var(--grey)' }}>
              Avg: {Math.round(reflexTimes.reduce((a, b) => a + b, 0) / reflexTimes.length)}ms
            </p>
          )}
        </>
        )}

        {step === 'submitting' && (
        <>
          <h1 className="step-title">Registering...</h1>
          <p className="step-sub">Creating your biometric profile with AWS Rekognition</p>
          <div style={{ marginTop: 40, color: 'var(--cyan)', fontSize: 48 }}>⬡</div>
        </>
        )}

        {step === 'success' && (
        <>
          <div className="badge badge-green" style={{ margin: '0 auto 20px' }}>✓ Registered</div>
          <h1 className="step-title">Access Profile Created</h1>
          <p className="step-sub">Welcome, {form.firstName}. Your access profile is now active.</p>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 10 }}>
            <div className="badge badge-cyan" style={{ marginBottom: 0 }}>device: {deviceType}</div>
          </div>

          <div className="card" style={{ width: '100%', marginTop: 8 }}>
            <div className="metric-row">
              <span className="metric-label">Worker ID</span>
              <span className="metric-value" style={{ fontSize: 11 }}>{workerId.slice(0,12)}...</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Employee ID</span>
              <span className="metric-value">{form.employeeId || '—'}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Access Level</span>
              <span className="metric-value">{form.accessLevel}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Name</span>
              <span className="metric-value">{form.firstName} {form.lastName}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Site</span>
              <span className="metric-value">{form.siteZone}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Company</span>
              <span className="metric-value">{form.company}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Facial confidence</span>
              <span className="metric-value">{confidence}%</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Stroop score</span>
              <span className="metric-value">{cognitive.stroopScore}%</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Reflex avg</span>
              <span className="metric-value">{cognitive.reflexAvgMs ?? 0}ms</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Vocal quality</span>
              <span className="metric-value">{cognitive.vocalQuality != null ? Math.round(cognitive.vocalQuality * 100) : 0}%</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Behavioral profile</span>
              <span className="metric-value">{behavioralCaptured ? 'captured ✓' : 'not captured'}</span>
            </div>

            <div className="metric-row">
              <span className="metric-label">Post-quantum signature</span>
              <span className="metric-value">{pqCaptured ? `${PQ_ALGORITHM} ✓` : 'not captured'}</span>
            </div>
          </div>
          <button className="btn btn-success" style={{ marginTop: 20 }} onClick={() => nav('/access')}>
            Request Access →
          </button>
        </>
      )}

        {step === 'error' && (
        <>
          <div className="badge" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.25)', margin: '0 auto 20px' }}>
            Error
          </div>
          <h1 className="step-title">Registration Failed</h1>
          <p className="step-sub">{errorMsg}</p>
          <button className="btn btn-outline" onClick={() => setStep('identity')}>Try Again</button>
        </>
        )}
      </div>
    </BehavioralCapture>
  )
}
