import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LanguageProvider } from './i18n'
import { AuthProvider } from './auth'
import './index.css'
import App from './App.tsx'
import { captureSsoCode } from './auth/ssoHandoff'
import { SsoHandoffGate } from './auth/SsoHandoffGate'

// MATTERS SSO (web only): read + strip a `#sso=` fragment BEFORE anything
// renders or any network activity happens. Inert on native, on the
// account-free /s/:token Gift reveal, and when the receiver is switched off.
captureSsoCode()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <AuthProvider>
        <App />
        <SsoHandoffGate />
      </AuthProvider>
    </LanguageProvider>
  </StrictMode>,
)
