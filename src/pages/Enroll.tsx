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

type Step = 'identity' | 'selfie' | 'stroop' | 'vocal' | 'submitting' | 'success' | 'error'

type VocalPhase = 'idle' | 'countdown' | 'recording' | 'processing' | 'done'

const PROGRESS: Record<Step, number> = {
  identity:10, selfie:30, stroop:50, vocal:75, submitting:95, success:100, error:0
}

const VOCAL_RECORD_MS = 3000
const VOCAL_COUNTDOWN_SEC = 3

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
      <div className="badge badge-cyan">Step 1 of 4 — Identity</div>
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
  const [vocalCountdown, setVocalCountdown] = useState(VOCAL_COUNTDOWN_SEC)

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
    setSelfieB64(b64)
    setTimeout(() => setStep('stroop'), 600)
  }

  function handleStroop(score: number) {
    setCog(c => ({ ...c, stroopScore: score }))
    setStep('vocal')
  }

  async function handleVocal() {
    setVocalPhase('countdown')
    setVocalCountdown(VOCAL_COUNTDOWN_SEC)

    for (let i = VOCAL_COUNTDOWN_SEC; i >= 1; i--) {
      setVocalCountdown(i)
      await new Promise(r => setTimeout(r, 1000))
    }

    setVocalPhase('recording')
    let samples: Float32Array
    try {
      samples = await voice.recordAudio(VOCAL_RECORD_MS)
    } catch (e) {
      console.error('[vocal] recordAudio failed', e)
      setCog(c => ({ ...c, vocalAccuracy: 0, vocalQuality: 0 }))
      setVocalPhase('idle')
      submitEnrollment()
      return
    }

    if (!samples || samples.length === 0) {
      setCog(c => ({ ...c, vocalAccuracy: 0, vocalQuality: 0 }))
      setVocalPhase('idle')
      submitEnrollment()
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
    submitEnrollment()
  }

  const onBehavioralController = useCallback((controller: BehavioralController) => {
    behavioralCtrlRef.current = controller
  }, [])

  async function submitEnrollment() {
    const final: CognitiveBaseline = {
      stroopScore: cognitive.stroopScore ?? 0,
      reflexVelocityMs: 0,
      vocalAccuracy: cognitive.vocalAccuracy ?? 0,
      vocalEmbedding: cognitive.vocalEmbedding,
      vocalQuality: cognitive.vocalQuality,
      vocalSimilarityThreshold: cognitive.vocalSimilarityThreshold ?? 0.75,
      reactionTimeMs: 0,
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
          <div className="badge badge-cyan">Step 2 of 4 — Biometric</div>
          <h1 className="step-title">Face Registration</h1>
          <p className="step-sub">Look directly at the camera. Ensure good lighting.</p>
          <SelfieCapture onCapture={handleSelfie} />
        </>
        )}

        {step === 'stroop' && (
        <>
          <div className="badge badge-amber">Step 3 of 4 — Cognitive</div>
          <h1 className="step-title">Stroop Test</h1>
          <StroopTest onComplete={handleStroop} />
        </>
        )}

        {step === 'vocal' && (
        <>
          <div className="badge badge-amber">Step 4 of 4 — Voice sample</div>
          <h1 className="step-title">Vocal Imprint</h1>
          <p className="step-sub">
            Read this sentence aloud when recording starts:
            <br />
            <em style={{ color: 'var(--ink, #fff)' }}>"I confirm my access registration."</em>
          </p>

          {vocalPhase === 'idle' && (
            <button className="btn btn-primary" type="button" onClick={handleVocal}>
              Start voice sample →
            </button>
          )}

          {vocalPhase === 'countdown' && (
            <div className="card" style={{ textAlign: 'center', padding: '28px 12px' }}>
              <p style={{ fontSize: 12, color: 'var(--grey)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                Get ready...
              </p>
              <p style={{ fontSize: 56, fontWeight: 800, color: 'var(--cyan, #06b6d4)', lineHeight: 1 }}>
                {vocalCountdown}
              </p>
            </div>
          )}

          {vocalPhase === 'recording' && (
            <div className="card" style={{ textAlign: 'center', padding: '20px 12px' }}>
              <p style={{ fontSize: 12, color: 'var(--grey)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                Recording...
              </p>
              <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--cyan, #06b6d4)' }}>
                {(voice.countdownMs / 1000).toFixed(1)}s
              </p>
              {voice.waveform && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, height: 40, marginTop: 12 }}>
                  {Array.from({ length: 24 }, (_, i) => {
                    const idx = Math.floor((i / 24) * voice.waveform!.length)
                    const v = Math.abs((voice.waveform![idx] - 128) / 128)
                    return (
                      <div key={i} style={{
                        width: 3, borderRadius: 2, transition: 'height 0.08s',
                        height: Math.max(4, v * 36),
                        background: 'var(--cyan, #06b6d4)', opacity: 0.7 + v * 0.3,
                      }} />
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {vocalPhase === 'processing' && (
            <div className="card" style={{ textAlign: 'center', padding: '28px 12px' }}>
              <p style={{ fontSize: 12, color: 'var(--grey)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                Processing...
              </p>
              <div style={{ fontSize: 28, color: 'var(--cyan, #06b6d4)' }}>⬡</div>
            </div>
          )}

          {vocalPhase === 'done' && (
            <div className="card" style={{ textAlign: 'center', padding: '28px 12px' }}>
              <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--green, #22c55e)' }}>
                Done ✓
              </p>
            </div>
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
