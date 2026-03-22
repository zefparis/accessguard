## Supabase schema notes (ACCESSGUARD)

```sql
-- ALTER TABLE edguard_enrollments
-- ADD COLUMN IF NOT EXISTS behavioral_profile JSONB;
-- ADD COLUMN IF NOT EXISTS pq_public_key TEXT;
-- ADD COLUMN IF NOT EXISTS pq_signature TEXT;
```

# ACCESSGUARD — Physical Access Control

Physical access control for sites, buildings, and restricted zones. Workers scan a QR code, verify identity biometrically, and access is granted or denied.

## Features

- **Enrollment** (6 steps): full biometric stack (based on the WorkGuard reference implementation)
  - Selfie → AWS Rekognition
  - Stroop Test
  - Neural Reflex
  - Vocal Imprint (MFCC)
  - Reaction Time
  - Behavioral capture (background)
  - Post-quantum signature (ML-KEM-768)

- **Access Request** (`/access`): QR scan or manual entry → selfie verification → granted/denied

- **Access Log** (`/log`): localStorage log (offline / air-gap ready), stats + export CSV

- **QR Generator** (`/qr-generator`): generate printable QR codes for site access points

- **Security**: AWS Rekognition facial matching with ML-KEM FIPS 203 encryption

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **State Management**: Zustand
- **Routing**: React Router v6
- **Styling**: Custom CSS with dark theme
- **API**: Hybrid Vector API (https://hybrid-vector-api.onrender.com)

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0

### Installation

```bash
npm install
```

### Environment Setup

Create a `.env` file in the root directory:

```env
VITE_API_URL=https://hybrid-vector-api.onrender.com
VITE_TENANT_ID=accessguard-demo
VITE_HV_API_KEY=accessguard-key-2026
```

Notes:
- The EDGUARD API validates `VITE_HV_API_KEY` against the `edguard_tenants` table.
- Example rows:
  - tenant_id: `accessguard-demo`, api_key: `accessguard-key-2026`
  - tenant_id: `payguard-demo`, api_key: `payguard-key-2026`

### Development

```bash
npm run dev
```

The app will be available at `http://localhost:3001`

### Build

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Project Structure

```
accessguard/
├── src/
│   ├── components/       # React components
│   │   ├── SelfieCapture.tsx
│   │   ├── StroopTest.tsx
│   │   ├── NeuralReflex.tsx
│   │   ├── VocalImprint.tsx
│   │   └── ReactionTime.tsx
│   ├── pages/           # Page components
│   │   ├── Home.tsx
│   │   ├── Enroll.tsx
│   │   ├── AccessRequest.tsx
│   │   ├── AccessLog.tsx
│   │   └── QrGeneratorPage.tsx
│   ├── hooks/           # Custom React hooks
│   │   └── useCamera.ts
│   ├── services/        # API services
│   │   └── api.ts
│   ├── store/           # Zustand store
│   │   └── accessguardStore.ts
│   ├── types/           # TypeScript types
│   │   └── index.ts
│   ├── App.tsx          # Main app component
│   ├── main.tsx         # Entry point
│   └── index.css        # Global styles
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Routes

- `/` - Home
- `/enroll` - Enrollment (6-step biometric registration)
- `/access` - Access request (QR scan + selfie)
- `/log` - Access log (today)
- `/qr-generator` - Generate access point QR

## Design

- **Theme**: Dark mode (#0a0f1e background)
- **Accent**: Amber (#f59e0b)
- **Layout**: Mobile-first, centered (max-width 480px)
- **Typography**: Inter font family

## API Integration

The app integrates with the Hybrid Vector API for:
- Enrollment (`POST /edguard/enroll`)
- Identity verification (`POST /edguard/verify`)

Access events are currently stored in localStorage (offline-first). Future backend schema:

```sql
-- CREATE TABLE IF NOT EXISTS access_logs (
--   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
--   tenant_id TEXT,
--   student_id TEXT,
--   first_name TEXT,
--   site TEXT,
--   zone TEXT,
--   access_point TEXT,
--   granted BOOLEAN,
--   similarity FLOAT,
--   accessed_at TIMESTAMPTZ DEFAULT now()
-- );
```

## Voice Biometrics (browser-only)

This project includes a client-side voice imprint using:
- `MediaRecorder` + Web Audio decoding
- MFCC extraction (40 coefficients)
- A lightweight 192-dim embedding + cosine similarity

The code is structured to later plug an ECAPA-TDNN ONNX model via `onnxruntime-web`.

## License

MIT

## Author

Hybrid Vector / CoreHuman
