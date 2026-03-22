import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelfieCapture } from '../components/SelfieCapture'
import { StroopTest } from '../components/StroopTest'
import { NeuralReflex } from '../components/NeuralReflex'
import { VocalImprint } from '../components/VocalImprint'
import { ReactionTime } from '../components/ReactionTime'
import { BehavioralCapture } from '../components/BehavioralCapture'
import type { BehavioralController, BehavioralProfile } from '../hooks/useBehavioral'
import { useAccessGuardStore } from '../store/accessguardStore'
import { enrollWorker } from '../services/api'
import { generateSessionKeypair, PQ_ALGORITHM, signProfile } from '../services/postQuantum'
import type { CognitiveBaseline } from '../types'

type Step = 'identity' | 'selfie' | 'stroop' | 'reflex' | 'vocal' | 'reaction' | 'submitting' | 'success' | 'error'

const PROGRESS: Record<Step, number> = {
  identity:10, selfie:25, stroop:45, reflex:60, vocal:75, reaction:88, submitting:95, success:100, error:0
}

export function Enroll() {
  const nav = useNavigate()
  const { setWorker, setSelfie, setCognitive } = useAccessGuardStore()

  const [step, setStep] = useState<Step>('identity')
  const [selfieB64, setSelfieB64] = useState('')
  const [cognitive, setCog] = useState<Partial<CognitiveBaseline>>({})
  const [errorMsg, setErrorMsg] = useState('')
  const [workerId, setWorkerId] = useState('')
  const [confidence, setConf] = useState(0)

  const behavioralCtrlRef = useRef<BehavioralController | null>(null)
  const [behavioralProfile, setBehavioralProfile] = useState<BehavioralProfile | null>(null)
  const [pqPublicKey, setPqPublicKey] = useState<string | null>(null)
  const [pqSignature, setPqSignature] = useState<string | null>(null)

  const deviceType = useMemo(() => behavioralProfile?.device.device_type ?? 'unknown', [behavioralProfile])

  const behavioralCaptured = useMemo(() => Boolean(behavioralProfile), [behavioralProfile])
  const pqCaptured = useMemo(() => Boolean(pqPublicKey && pqSignature), [pqPublicKey, pqSignature])

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    employeeId: '',
    accessLevel: 'Staff' as 'Visitor' | 'Staff' | 'Manager' | 'Security',
    siteZone: '',
    company: '',
    email: '',
  })

  function field(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }))
  }

  async function handleIdentity(e: React.FormEvent) {
    e.preventDefault()
    if (!form.firstName || !form.lastName || !form.company || !form.siteZone) return
    setStep('selfie')
  }

  function handleSelfie(b64: string) {
    setSelfieB64(b64)
    setTimeout(() => setStep('stroop'), 600)
  }

  function handleStroop(score: number) {
    setCog(c => ({ ...c, stroopScore: score }))
    setStep('reflex')
  }

  function handleReflex(ms: number) {
    setCog(c => ({ ...c, reflexVelocityMs: ms }))
    setStep('vocal')
  }

  function handleVocal(result: { embedding: number[]; quality: number; threshold: number }) {
    // Store voice biometrics locally
    setCog(c => ({
      ...c,
      vocalAccuracy: Math.round(result.quality * 100),
      vocalEmbedding: result.embedding,
      vocalQuality: result.quality,
      vocalSimilarityThreshold: result.threshold,
    }))
    setStep('reaction')
  }

  const onBehavioralController = useCallback((controller: BehavioralController) => {
    behavioralCtrlRef.current = controller
  }, [])

  async function handleReaction(ms: number) {
    const final: CognitiveBaseline = {
      stroopScore: cognitive.stroopScore ?? 0,
      reflexVelocityMs: cognitive.reflexVelocityMs ?? 0,
      vocalAccuracy: cognitive.vocalAccuracy ?? 0,
      vocalEmbedding: cognitive.vocalEmbedding,
      vocalQuality: cognitive.vocalQuality,
      vocalSimilarityThreshold: cognitive.vocalSimilarityThreshold ?? 0.75,
      reactionTimeMs: ms,
    }
    setCog(final)
    setStep('submitting')

    try {
      // Stop behavioral capture and finalize profile right before submit
      const behavioral = behavioralCtrlRef.current?.stop()
      if (behavioral) setBehavioralProfile(behavioral)

      const cognitiveBaseline = {
        stroop_score: final.stroopScore / 100,
        reflex_velocity_ms: final.reflexVelocityMs,
        vocal_accuracy: final.vocalAccuracy / 100,
        reaction_time_ms: final.reactionTimeMs,
        // New voice biometrics payload (stored in Supabase)
        // -- ALTER TABLE edguard_enrollments
        // -- ADD COLUMN IF NOT EXISTS vocal_embedding JSONB;
        // -- ADD COLUMN IF NOT EXISTS vocal_quality FLOAT;
        vocal_embedding: final.vocalEmbedding,
        vocal_quality: final.vocalQuality,
        vocal_similarity_threshold: final.vocalSimilarityThreshold,
        // New behavioral + post-quantum layers
        // -- ALTER TABLE edguard_enrollments
        // -- ADD COLUMN IF NOT EXISTS behavioral_profile JSONB;
        // -- ADD COLUMN IF NOT EXISTS pq_public_key TEXT;
        // -- ADD COLUMN IF NOT EXISTS pq_signature TEXT;
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
    <BehavioralCapture onController={onBehavioralController}>
      <div className="page">
        <div className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>← ACCESSGUARD</div>

        <div className="progress-bar" style={{ width: '100%', maxWidth: 440 }}>
          <div className="progress-fill" style={{ width: `${PROGRESS[step]}%` }} />
        </div>

        {step === 'identity' && (
        <>
          <div className="badge badge-cyan">Step 1 of 6 — Identity</div>
          <h1 className="step-title">Access Registration</h1>
          <p className="step-sub">Create your physical access profile for secure sites.</p>
          <form onSubmit={handleIdentity} style={{ width: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>First Name *</label>
                <input value={form.firstName} onChange={field('firstName')} required placeholder="John" />
              </div>
              <div className="field">
                <label>Last Name *</label>
                <input value={form.lastName} onChange={field('lastName')} required placeholder="Smith" />
              </div>
            </div>
            <div className="field">
              <label>Employee ID</label>
              <input value={form.employeeId} onChange={field('employeeId')} placeholder="EMP-001" />
            </div>
            <div className="field">
              <label>Access Level *</label>
              <select value={form.accessLevel} onChange={field('accessLevel')} required>
                <option value="Visitor">Visitor</option>
                <option value="Staff">Staff</option>
                <option value="Manager">Manager</option>
                <option value="Security">Security</option>
              </select>
            </div>
            <div className="field">
              <label>Site / Zone *</label>
              <input value={form.siteZone} onChange={field('siteZone')} required placeholder="Zone B — Restricted" />
            </div>
            <div className="field">
              <label>Company *</label>
              <input value={form.company} onChange={field('company')} required placeholder="ACME Mining" />
            </div>
            <div className="field">
              <label>Email (optional)</label>
              <input value={form.email} onChange={field('email')} placeholder="john@company.com" type="email" />
            </div>
            <button className="btn btn-primary" type="submit">
              Continue →
            </button>
          </form>
        </>
        )}

        {step === 'selfie' && (
        <>
          <div className="badge badge-cyan">Step 2 of 6 — Biometric</div>
          <h1 className="step-title">Face Registration</h1>
          <p className="step-sub">Look directly at the camera. Ensure good lighting.</p>
          <SelfieCapture onCapture={handleSelfie} />
        </>
        )}

        {step === 'stroop' && (
        <>
          <div className="badge badge-amber">Step 3 of 6 — Cognitive</div>
          <h1 className="step-title">Stroop Test</h1>
          <StroopTest onComplete={handleStroop} />
        </>
        )}

        {step === 'reflex' && (
        <>
          <div className="badge badge-amber">Step 4 of 6 — Cognitive</div>
          <h1 className="step-title">Neural Reflex</h1>
          <NeuralReflex onComplete={handleReflex} />
        </>
        )}

        {step === 'vocal' && (
        <>
          <div className="badge badge-amber">Step 5 of 6 — Cognitive</div>
          <h1 className="step-title">Vocal Imprint</h1>
          <VocalImprint onComplete={handleVocal} />
        </>
        )}

        {step === 'reaction' && (
        <>
          <div className="badge badge-amber">Step 6 of 6 — Cognitive</div>
          <h1 className="step-title">Reaction Time</h1>
          <ReactionTime onComplete={handleReaction} />
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
              <span className="metric-label">Reflex velocity</span>
              <span className="metric-value">{cognitive.reflexVelocityMs}ms</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Reaction time</span>
              <span className="metric-value">{cognitive.reactionTimeMs}ms</span>
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
