export interface WorkerProfile {
  workerId: string
  firstName: string
  lastName: string
  employeeId: string
  jobRole: string
  employerSite: string
  tenantId: string
  rekognitionFaceId?: string
  cognitiveBaseline?: CognitiveBaseline
  enrolledAt?: string
}

export interface CognitiveBaseline {
  stroopScore: number
  stroopAccuracy?: number
  reflexVelocityMs: number
  reflexAvgMs?: number
  reflexScores?: number[]
  // Legacy numeric score kept for UI compatibility (0-100)
  vocalAccuracy: number
  // New: lightweight speaker embedding (192-dim)
  vocalEmbedding?: number[]
  // New: enrollment quality (0-1)
  vocalQuality?: number
  // New: similarity threshold used for verification
  vocalSimilarityThreshold?: number
  reactionTimeMs: number
}

export interface AccessRequestResult {
  verified: boolean
  similarity: number
  workerId: string
  firstName: string
  accessedAt: string
}

export interface EnrollResult {
  success: boolean
  workerId: string
  confidence: number
}

export type AppStep =
  | 'home'
  | 'enroll-identity'
  | 'enroll-selfie'
  | 'enroll-cognitive'
  | 'enroll-success'
  | 'access-identity'
  | 'access-selfie'
  | 'access-result'
