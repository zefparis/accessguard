import { sha3_256 } from '@noble/hashes/sha3.js'
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js'

export const PQ_ALGORITHM = 'ML-KEM-768' as const

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, '0')
  return out
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.trim().toLowerCase().replace(/^0x/, '')
  if (h.length % 2 !== 0) throw new Error('Invalid hex')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
  return out
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort()
    const inner = keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')
    return `{${inner}}`
  }
  return 'null'
}

function hashProfileBytes(profile: object): Uint8Array {
  const canonical = stableStringify(profile)
  const msg = new TextEncoder().encode(canonical)
  return sha3_256(msg)
}

export function generateSessionKeypair(): { publicKey: string; privateKey: string } {
  const keys = ml_kem768.keygen()
  return {
    publicKey: bytesToHex(keys.publicKey),
    privateKey: bytesToHex(keys.secretKey),
  }
}

// Deterministic "signature" primitive built from ML-KEM:
// - Hash the profile (SHA3-256)
// - Use the hash as deterministic msg parameter to encapsulate()
// - Signature is the resulting ciphertext (anyone with public key can recompute)
export function signProfile(profile: object, privateKeyHex: string): string {
  const sk = hexToBytes(privateKeyHex)
  const pk = ml_kem768.getPublicKey(sk)
  const msg = hashProfileBytes(profile) // 32 bytes
  const { cipherText } = ml_kem768.encapsulate(pk, msg)
  return bytesToHex(cipherText)
}

export function verifyProfile(profile: object, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const pk = hexToBytes(publicKeyHex)
    const msg = hashProfileBytes(profile)
    const { cipherText } = ml_kem768.encapsulate(pk, msg)
    return bytesToHex(cipherText) === signatureHex.trim().toLowerCase().replace(/^0x/, '')
  } catch {
    return false
  }
}
