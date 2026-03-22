import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CognitiveBaseline, WorkerProfile } from '../types'

interface AccessGuardStore {
  worker: WorkerProfile | null
  selfieB64: string | null
  cognitiveBaseline: CognitiveBaseline | null
  setWorker: (w: WorkerProfile) => void
  setSelfie: (b64: string) => void
  setCognitive: (c: CognitiveBaseline) => void
  reset: () => void
}

export const useAccessGuardStore = create<AccessGuardStore>()(
  persist(
    (set) => ({
      worker: null,
      selfieB64: null,
      cognitiveBaseline: null,
      setWorker: (w) => set({ worker: w }),
      setSelfie: (b64) => set({ selfieB64: b64 }),
      setCognitive: (c) => set({ cognitiveBaseline: c }),
      reset: () => set({ worker: null, selfieB64: null, cognitiveBaseline: null }),
    }),
    { name: 'accessguard-store' }
  )
)
