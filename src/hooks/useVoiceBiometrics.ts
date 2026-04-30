import { useCallback, useMemo, useRef, useState } from 'react'
import * as ort from 'onnxruntime-web'

// NOTE: We import onnxruntime-web now so we can later plug an ECAPA-TDNN ONNX model
// without changing call sites. The current implementation uses an MFCC-based
// lightweight embedding for browser-only speaker verification.

export type VoiceEnrollResult = {
  embedding: number[]
  score: number // 0..1 quality
}

export type VoiceVerifyResult = {
  matched: boolean
  similarity: number // 0..1
}

type UseVoiceBiometrics = {
  isRecording: boolean
  countdownMs: number
  waveform: Uint8Array | null

  recordAudio: (durationMs: number) => Promise<Float32Array>
  extractMFCC: (audioData: Float32Array, sampleRate: number) => Float32Array
  computeSimilarity: (emb1: Float32Array, emb2: Float32Array) => number

  enrollVoice: (rounds: number) => Promise<VoiceEnrollResult>
  verifyVoice: (storedEmbedding: number[]) => Promise<VoiceVerifyResult>
}

// ---------- helpers ----------

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

function mean(arr: Float32Array): number {
  let s = 0
  for (let i = 0; i < arr.length; i += 1) s += arr[i]
  return arr.length ? s / arr.length : 0
}

function rms(arr: Float32Array): number {
  let s = 0
  for (let i = 0; i < arr.length; i += 1) s += arr[i] * arr[i]
  return arr.length ? Math.sqrt(s / arr.length) : 0
}

function toMonoFloat32(audioBuffer: AudioBuffer): Float32Array {
  if (audioBuffer.numberOfChannels === 1) return audioBuffer.getChannelData(0)
  const left = audioBuffer.getChannelData(0)
  const right = audioBuffer.getChannelData(1)
  const out = new Float32Array(audioBuffer.length)
  for (let i = 0; i < out.length; i += 1) out[i] = (left[i] + right[i]) * 0.5
  return out
}

function resampleLinear(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input
  const ratio = outputRate / inputRate
  const outLen = Math.max(1, Math.floor(input.length * ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i += 1) {
    const t = i / ratio
    const i0 = Math.floor(t)
    const i1 = Math.min(input.length - 1, i0 + 1)
    const frac = t - i0
    out[i] = input[i0] * (1 - frac) + input[i1] * frac
  }
  return out
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}

function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1)
}

function hamming(N: number): Float32Array {
  const w = new Float32Array(N)
  for (let n = 0; n < N; n += 1) {
    w[n] = 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (N - 1))
  }
  return w
}

function dctII(vector: Float32Array, numCoeffs: number): Float32Array {
  const N = vector.length
  const out = new Float32Array(numCoeffs)
  for (let k = 0; k < numCoeffs; k += 1) {
    let sum = 0
    for (let n = 0; n < N; n += 1) {
      sum += vector[n] * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N))
    }
    out[k] = sum
  }
  return out
}

function createMelFilterbank(
  sampleRate: number,
  fftSize: number,
  numFilters: number,
  fMin = 20,
  fMax = 8000
): Float32Array[] {
  const nyquist = sampleRate / 2
  const maxHz = Math.min(fMax, nyquist)

  const melMin = hzToMel(fMin)
  const melMax = hzToMel(maxHz)
  const melPoints: number[] = []
  for (let i = 0; i < numFilters + 2; i += 1) {
    melPoints.push(melMin + (i / (numFilters + 1)) * (melMax - melMin))
  }
  const hzPoints = melPoints.map(m => melToHz(m))
  const binPoints = hzPoints.map(hz => Math.floor(((fftSize + 1) * hz) / sampleRate))

  const filters: Float32Array[] = []
  const numBins = Math.floor(fftSize / 2) + 1

  for (let m = 1; m <= numFilters; m += 1) {
    const f = new Float32Array(numBins)
    const left = binPoints[m - 1]
    const center = binPoints[m]
    const right = binPoints[m + 1]

    for (let k = left; k < center; k += 1) {
      if (k >= 0 && k < numBins) f[k] = (k - left) / Math.max(1, center - left)
    }
    for (let k = center; k < right; k += 1) {
      if (k >= 0 && k < numBins) f[k] = (right - k) / Math.max(1, right - center)
    }
    filters.push(f)
  }
  return filters
}

// Direct DFT magnitude spectrum — O(N^2) per frame but N is small (~512).
// Pre-compute twiddle factors once per fftSize to avoid repeated cos/sin calls.
const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array }>()
function getTwiddle(fftSize: number): { cos: Float64Array; sin: Float64Array } {
  let t = twiddleCache.get(fftSize)
  if (t) return t
  const cos = new Float64Array(fftSize)
  const sin = new Float64Array(fftSize)
  for (let n = 0; n < fftSize; n += 1) {
    cos[n] = Math.cos((2 * Math.PI * n) / fftSize)
    sin[n] = Math.sin((2 * Math.PI * n) / fftSize)
  }
  t = { cos, sin }
  twiddleCache.set(fftSize, t)
  return t
}

function spectrumFromFrame(frame: Float32Array, _sampleRate: number, fftSize: number): Float32Array {
  const numBins = (fftSize >> 1) + 1
  const out = new Float32Array(numBins)
  const { cos: twCos, sin: twSin } = getTwiddle(fftSize)
  for (let k = 0; k < numBins; k += 1) {
    let re = 0
    let im = 0
    for (let n = 0; n < fftSize; n += 1) {
      const x = frame[n]
      const idx = (k * n) % fftSize
      re += x * twCos[idx]
      im -= x * twSin[idx]
    }
    out[k] = Math.sqrt(re * re + im * im)
  }
  return out
}

export function useVoiceBiometrics(): UseVoiceBiometrics {
  const [isRecording, setIsRecording] = useState(false)
  const [countdownMs] = useState(0)
  const [waveform] = useState<Uint8Array | null>(null)

  const streamRef = useRef<MediaStream | null>(null)

  const recordAudio = useCallback(async (durationMs: number) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    streamRef.current = stream

    // Skip waveform rAF loop — vocal UI doesn't display it
    setIsRecording(true)

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    const recorder = new MediaRecorder(stream, { mimeType })
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }

    recorder.start()
    await new Promise<void>(resolve => setTimeout(resolve, durationMs))
    recorder.stop()

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
    })

    setIsRecording(false)

    stream.getTracks().forEach(t => t.stop())
    streamRef.current = null

    const arrayBuffer = await blob.arrayBuffer()
    const audioCtx = new AudioContext()
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
    const mono = toMonoFloat32(audioBuffer)

    // Standardize to 16kHz for consistent MFCC extraction
    const TARGET_SR = 16000
    return resampleLinear(mono, audioBuffer.sampleRate, TARGET_SR)
  }, [])

  const extractMFCC = useCallback((audioData: Float32Array, sampleRate: number): Float32Array => {
    console.time('mfcc-extraction')
    // 25ms window, 10ms hop
    const winSize = Math.floor(sampleRate * 0.025)
    const hopSize = Math.floor(sampleRate * 0.01)
    const fftSize = 1 << Math.ceil(Math.log2(winSize))
    const numMfcc = 40
    const numFilters = 40

    const windowFn = hamming(winSize)
    const filters = createMelFilterbank(sampleRate, fftSize, numFilters)

    const frames: Float32Array[] = []
    for (let start = 0; start + winSize <= audioData.length; start += hopSize) {
      const frame = new Float32Array(fftSize)
      for (let i = 0; i < winSize; i += 1) frame[i] = audioData[start + i] * windowFn[i]
      frames.push(frame)
    }

    if (frames.length === 0) {
      console.timeEnd('mfcc-extraction')
      return new Float32Array(192)
    }

    // Mean-pool MFCCs over time to get a stable vector
    const mfccSum = new Float32Array(numMfcc)

    for (const frame of frames) {
      const spectrum = spectrumFromFrame(frame, sampleRate, fftSize)
      const melEnergies = new Float32Array(numFilters)

      for (let m = 0; m < numFilters; m += 1) {
        let e = 0
        const f = filters[m]
        for (let k = 0; k < spectrum.length; k += 1) e += (spectrum[k] ** 2) * f[k]
        melEnergies[m] = Math.log(1e-10 + e)
      }

      const mfcc = dctII(melEnergies, numMfcc)
      for (let i = 0; i < numMfcc; i += 1) mfccSum[i] += mfcc[i]
    }

    for (let i = 0; i < numMfcc; i += 1) mfccSum[i] /= frames.length

    // Build a 192-dim embedding from MFCC stats.
    // Strategy: repeat the 40-dim mean vector and pad with zeros.
    const targetDim = 192
    const emb = new Float32Array(targetDim)
    let offset = 0
    while (offset < targetDim) {
      const take = Math.min(numMfcc, targetDim - offset)
      emb.set(mfccSum.subarray(0, take), offset)
      offset += take
    }

    // Simple L2 normalization
    let norm = 0
    for (let i = 0; i < emb.length; i += 1) norm += emb[i] * emb[i]
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < emb.length; i += 1) emb[i] /= norm

    console.timeEnd('mfcc-extraction')
    return emb
  }, [])

  const computeSimilarity = useCallback((emb1: Float32Array, emb2: Float32Array): number => {
    const len = Math.min(emb1.length, emb2.length)
    let dot = 0
    let n1 = 0
    let n2 = 0
    for (let i = 0; i < len; i += 1) {
      dot += emb1[i] * emb2[i]
      n1 += emb1[i] * emb1[i]
      n2 += emb2[i] * emb2[i]
    }
    const denom = Math.sqrt(n1) * Math.sqrt(n2) || 1
    // map [-1,1] -> [0,1]
    return clamp01((dot / denom + 1) / 2)
  }, [])

  const enrollVoice = useCallback(async (rounds: number): Promise<VoiceEnrollResult> => {
    const ROUND_MS = 2000
    const embeddings: Float32Array[] = []
    const qualities: number[] = []

    for (let i = 0; i < rounds; i += 1) {
      const samples = await recordAudio(ROUND_MS)
      const emb = extractMFCC(samples, 16000)
      embeddings.push(emb)

      // quality heuristic: energy + duration coverage
      const qEnergy = clamp01((rms(samples) - 0.01) / 0.1)
      qualities.push(qEnergy)
    }

    const dim = embeddings[0]?.length ?? 192
    const avg = new Float32Array(dim)
    for (const e of embeddings) {
      for (let j = 0; j < dim; j += 1) avg[j] += e[j]
    }
    for (let j = 0; j < dim; j += 1) avg[j] /= embeddings.length

    // normalize
    let norm = 0
    for (let j = 0; j < dim; j += 1) norm += avg[j] * avg[j]
    norm = Math.sqrt(norm) || 1
    for (let j = 0; j < dim; j += 1) avg[j] /= norm

    return {
      embedding: Array.from(avg),
      score: clamp01(mean(Float32Array.from(qualities))),
    }
  }, [extractMFCC, recordAudio])

  const verifyVoice = useCallback(async (storedEmbedding: number[]): Promise<VoiceVerifyResult> => {
    const samples = await recordAudio(2000)
    const emb = extractMFCC(samples, 16000)
    const stored = new Float32Array(storedEmbedding)
    const similarity = computeSimilarity(emb, stored)
    const matched = similarity >= 0.75
    return { matched, similarity }
  }, [computeSimilarity, extractMFCC, recordAudio])

  // keep ort referenced so bundlers don't tree-shake it completely
  useMemo(() => ort.env, [])

  return {
    isRecording,
    countdownMs,
    waveform,
    recordAudio,
    extractMFCC,
    computeSimilarity,
    enrollVoice,
    verifyVoice,
  }
}
