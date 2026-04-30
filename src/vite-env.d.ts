/// <reference types="vite/client" />

declare module '*.css' {
  const content: string
  export default content
}

declare module 'react-dom/client' {
  import { ReactNode } from 'react'
  interface Root {
    render(children: ReactNode): void
    unmount(): void
  }
  export function createRoot(container: Element | DocumentFragment): Root
}

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_HV_API_KEY: string
  readonly VITE_TENANT_ID: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
