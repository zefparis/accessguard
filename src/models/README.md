# Models

## ECAPA-TDNN speaker verification (recommended)

We want to replace the current simulated **Vocal Imprint** with real speaker verification.

Reference model:
- https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb

Expected placement (after ONNX conversion):
- `public/models/speaker_verification.onnx`

Notes:
- This repository does **not** ship the ONNX model file.
- Convert/export the model to ONNX separately and place it under `public/models/`.

## Lightweight browser-first fallback (current)

Until an ONNX ECAPA-TDNN pipeline is wired end-to-end, we use a lightweight browser-only approach:

- Record audio in the browser using `MediaRecorder`.
- Decode it via Web Audio API.
- Extract MFCC features (40 coefficients).
- Produce a fixed 192-dim “speaker embedding” (mean-pooled + padded).
- Verify using cosine similarity.

This is **not** equivalent to ECAPA-TDNN accuracy, but it is:
- fully client-side
- fast enough for mobile
- good for prototyping the biometric UX and payload format
