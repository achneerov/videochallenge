import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { debug } from './lib/debug'
import './index.css'

debug('Main', 'app booting', {
  userAgent: navigator.userAgent,
  href: window.location.href,
  mediaDevices: Boolean(navigator.mediaDevices),
  rtcPeerConnection: Boolean(window.RTCPeerConnection),
  build: document.querySelector('meta[name="app-build"]')?.getAttribute('content') ?? 'unknown',
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
