export const CHALLENGE_DURATION_MS = 10_000
export const COUNTDOWN_DURATION_MS = 3_000

export const FACE_API_MODEL_URL =
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model'

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.relay.metered.ca:80' },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp',
      'turns:openrelay.metered.ca:443',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
  {
    urls: [
      'turn:relay.metered.ca:80',
      'turn:relay.metered.ca:443',
      'turn:relay.metered.ca:443?transport=tcp',
      'turns:relay.metered.ca:443',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

export const MAX_ICE_RESTARTS = 3
