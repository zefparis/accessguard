import { useNavigate } from 'react-router-dom'
import { QRGenerator } from '../components/QRGenerator'

export function QrGeneratorPage() {
  const nav = useNavigate()
  return (
    <div className="page">
      <div className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>← ACCESSGUARD</div>
      <div className="badge badge-cyan">QR Generator</div>
      <h1 className="step-title">Generate Site QR</h1>
      <p className="step-sub">Create a QR code for an access point. Managers can print it and place it on-site.</p>
      <QRGenerator />
    </div>
  )
}
