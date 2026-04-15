const API = import.meta.env.VITE_API_URL || 'https://hybrid-vector-api.fly.dev'
// Require explicit env config (no silent fallbacks in production)
const TENANT = import.meta.env.VITE_TENANT_ID
const API_KEY = import.meta.env.VITE_HV_API_KEY

const headers = () => {
  if (!API_KEY) throw new Error('Missing VITE_HV_API_KEY')
  if (!TENANT) throw new Error('Missing VITE_TENANT_ID')

  return {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
  }
}

export async function enrollWorker(payload: {
  selfie_b64: string
  first_name: string
  last_name: string
  email: string
  tenant_id: string
  cognitive_baseline?: {
    stroop_score?: number
    reflex_velocity_ms?: number
    vocal_accuracy?: number
    // New voice biometrics
    vocal_embedding?: number[]
    vocal_quality?: number
    vocal_similarity_threshold?: number
    reaction_time_ms?: number
    [key: string]: unknown
  }
}): Promise<{ success: boolean; student_id: string; confidence: number }> {
  const res = await fetch(`${API}/edguard/enroll`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ...payload, tenant_id: TENANT }),
  })
  if (!res.ok) throw new Error(`Enroll failed: ${res.status}`)
  return res.json()
}

export async function verifyWorker(payload: {
  selfie_b64: string
  first_name: string
  last_name: string
}): Promise<{ verified: boolean; similarity: number; student_id: string; first_name: string }> {
  const res = await fetch(`${API}/edguard/verify`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ...payload, tenant_id: TENANT }),
  })
  if (!res.ok) throw new Error(`Verify failed: ${res.status}`)
  return res.json()
}
