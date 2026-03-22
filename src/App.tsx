import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Home } from './pages/Home'
import { Enroll } from './pages/Enroll'
import { AccessRequest } from './pages/AccessRequest'
import { AccessLog } from './pages/AccessLog'
import { QrGeneratorPage } from './pages/QrGeneratorPage'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"        element={<Home />} />
        <Route path="/enroll"  element={<Enroll />} />
        <Route path="/access" element={<AccessRequest />} />
        <Route path="/log" element={<AccessLog />} />
        <Route path="/qr-generator" element={<QrGeneratorPage />} />
      </Routes>
    </BrowserRouter>
  )
}
