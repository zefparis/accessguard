import { useNavigate } from 'react-router-dom'

export function Home() {
  const nav = useNavigate()
  return (
    <div className="page">
      <div className="logo">⬡ ACCESSGUARD</div>
      <h1 className="step-title" style={{ fontSize: 30, marginBottom: 8 }}>Physical Access Control</h1>
      <p className="step-sub">
        Biometric entry verification for secure sites.<br />
        Powered by Hybrid Vector — 3 French patents.
      </p>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
        <div className="card" style={{ cursor: 'pointer' }} onClick={() => nav('/enroll')}>
          <div className="badge badge-cyan">First time</div>
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>Register</h2>
          <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.6 }}>
            First-time enrollment — takes 3 minutes.<br />
            Identity + biometric profile + cognitive baseline.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 20 }}>
            Start Enrollment →
          </button>
        </div>

        <div className="card" style={{ cursor: 'pointer' }} onClick={() => nav('/access')}>
          <div className="badge badge-green">Live</div>
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>Request Access</h2>
          <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.6 }}>
            Scan site QR + selfie → access granted or denied.<br />
            Takes under 20 seconds.
          </p>
          <button className="btn btn-success" style={{ marginTop: 20 }}>
            Request Access →
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18, width: '100%' }}>
        <button className="btn btn-outline" onClick={() => nav('/log')}>View Access Log →</button>
        <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={() => nav('/qr-generator')}>Generate Site QR →</button>
      </div>

      <div style={{ marginTop: 26, display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        {['Air-gap ready', 'Post-Quantum FIPS 203', '3 French Patents'].map(t => (
          <span key={t} className="badge badge-cyan">{t}</span>
        ))}
      </div>
    </div>
  )
}
