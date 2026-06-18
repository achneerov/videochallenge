import { useEffect, useRef, useState } from 'react'
import { ICE_SERVERS, MAX_ICE_RESTARTS } from '../lib/constants'
import { debugError, debugWarn, diag } from '../lib/debug'
import { supabase } from '../lib/supabase'
import type { SignalPayload } from '../types'

function isIceConnected(pc: RTCPeerConnection | null): boolean {
  return (
    pc?.iceConnectionState === 'connected' ||
    pc?.iceConnectionState === 'completed'
  )
}

function shouldSkipOutgoingCandidate(candidate: string): boolean {
  return candidate.includes('.local')
}

export function useWebRTC(
  lobbyId: string | null,
  playerId: string,
  isHost: boolean,
  enabled: boolean,
) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const isHostRef = useRef(isHost)

  isHostRef.current = isHost

  useEffect(() => {
    if (!lobbyId || !enabled || !supabase) return

    const client = supabase
    let active = true
    let channel = client.channel(`webrtc:${lobbyId}`, {
      config: { broadcast: { self: false } },
    })
    let offerRetryTimer: number | null = null
    let recoveryTimer: number | null = null
    let signalChain = Promise.resolve()
    let channelReady = false
    let outboundQueue: SignalPayload[] = []
    let iceSent = 0
    let iceReceived = 0
    let iceSkipped = 0
    let iceRestartCount = 0
    let useRelayOnly = false
    let lastIceState = ''
    let lastConnState = ''
    let lastSigState = ''
    let peerPresent = false
    let iceWasConnected = false
    let makingOffer = false
    let recovering = false
    let pendingIce: RTCIceCandidateInit[] = []

    setError(null)
    setRemoteStream(null)
    setConnected(false)

    const snapshot = () => ({
      isHost: isHostRef.current,
      channelReady,
      peerPresent,
      iceWasConnected,
      useRelayOnly,
      connected: isIceConnected(pcRef.current),
      signalingState: pcRef.current?.signalingState ?? 'none',
      iceState: pcRef.current?.iceConnectionState ?? 'none',
      connState: pcRef.current?.connectionState ?? 'none',
      pendingIce: pendingIce.length,
      iceRestartCount,
      iceSent,
      iceReceived,
    })

    const syncConnected = () => {
      setConnected(isIceConnected(pcRef.current))
    }

    const clearRecoveryTimer = () => {
      if (recoveryTimer != null) {
        window.clearTimeout(recoveryTimer)
        recoveryTimer = null
      }
    }

    const scheduleRecovery = (reason: string) => {
      if (!active || iceWasConnected || isIceConnected(pcRef.current) || recovering) return
      clearRecoveryTimer()
      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = null
        if (!active || iceWasConnected || isIceConnected(pcRef.current)) return
        diag('RTC', `recovering (${reason})`, snapshot())
        void attemptRecovery()
      }, 1500)
    }

    diag('RTC', 'session starting', { lobbyId, playerId, isHost })

    const flushOutbound = () => {
      if (!channelReady || outboundQueue.length === 0) return
      const batch = outboundQueue
      outboundQueue = []
      for (const payload of batch) void deliverSignal(payload)
    }

    const deliverSignal = async (payload: SignalPayload) => {
      try {
        if (channelReady) {
          await channel.send({ type: 'broadcast', event: 'signal', payload })
        } else {
          await channel.httpSend('signal', payload)
        }
        if (payload.type !== 'ice') {
          diag('RTC', `sent ${payload.type}`, snapshot())
        }
      } catch (err) {
        diag('RTC', `send ${payload.type} FAILED`, { err, ...snapshot() })
        debugError('useWebRTC', 'sendSignal failed', err)
      }
    }

    const sendSignal = (payload: SignalPayload) => {
      if (!channelReady) {
        outboundQueue.push(payload)
        if (payload.type !== 'ice') {
          diag('RTC', `queued ${payload.type} (channel not ready)`, snapshot())
        }
        return
      }
      void deliverSignal(payload)
    }

    const flushPendingIce = async (pc: RTCPeerConnection) => {
      if (!pc.remoteDescription) return
      const batch = pendingIce
      pendingIce = []
      if (batch.length > 0) {
        diag('RTC', `flushing ${batch.length} queued ICE candidates`, snapshot())
      }
      for (const candidate of batch) {
        try {
          await pc.addIceCandidate(candidate)
        } catch (err) {
          debugWarn('useWebRTC', 'queued ICE candidate failed', err)
        }
      }
    }

    const attachLocalTracks = (pc: RTCPeerConnection) => {
      const stream = localStreamRef.current
      if (!stream) return
      for (const track of stream.getTracks()) {
        if (!pc.getSenders().some((s) => s.track?.id === track.id)) {
          pc.addTrack(track, stream)
        }
      }
    }

    const bindPeerEvents = (pc: RTCPeerConnection) => {
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const cand = event.candidate.candidate
          if (shouldSkipOutgoingCandidate(cand)) {
            iceSkipped++
            return
          }
          iceSent++
          if (iceSent <= 3 || iceSent % 10 === 0) {
            diag('RTC', `ICE sent (${iceSent})`, {
              type: event.candidate.type,
              protocol: event.candidate.protocol,
              address: event.candidate.address,
              ...snapshot(),
            })
          }
          sendSignal({
            type: 'ice',
            candidate: event.candidate.toJSON(),
            from: playerId,
          })
        } else {
          diag('RTC', 'ICE gathering complete', snapshot())
        }
      }

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState !== lastIceState) {
          lastIceState = pc.iceConnectionState
          diag('RTC', 'ice connection state', { state: pc.iceConnectionState, ...snapshot() })
        }
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          iceWasConnected = true
          recovering = false
          clearRecoveryTimer()
          syncConnected()
        }
        if (
          pc.iceConnectionState === 'failed' ||
          pc.iceConnectionState === 'disconnected'
        ) {
          syncConnected()
          if (!iceWasConnected && peerPresent) {
            scheduleRecovery(`ice-${pc.iceConnectionState}`)
          }
        }
      }

      pc.onsignalingstatechange = () => {
        if (pc.signalingState !== lastSigState) {
          lastSigState = pc.signalingState
          diag('RTC', 'signaling state', { state: pc.signalingState, ...snapshot() })
        }
      }

      pc.ontrack = (event) => {
        if (!active) return
        const stream =
          event.streams[0] ??
          (() => {
            if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream()
            if (
              !remoteStreamRef.current
                .getTracks()
                .some((t) => t.id === event.track.id)
            ) {
              remoteStreamRef.current.addTrack(event.track)
            }
            return remoteStreamRef.current
          })()

        remoteStreamRef.current = stream
        diag('RTC', 'remote stream negotiated', {
          streamId: stream.id,
          tracks: stream.getTracks().map((t) => ({
            kind: t.kind,
            readyState: t.readyState,
          })),
          iceState: pc.iceConnectionState,
        })
        setRemoteStream(stream)
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== lastConnState) {
          lastConnState = pc.connectionState
          diag('RTC', 'connection state', { state: pc.connectionState, ...snapshot() })
        }
        if (pc.connectionState === 'connected') syncConnected()
        if (pc.connectionState === 'failed' && !iceWasConnected && peerPresent) {
          scheduleRecovery('connection-failed')
        }
      }
    }

    const createPeerConnection = () => {
      diag('RTC', 'creating peer connection', {
        iceServers: ICE_SERVERS.length,
        useRelayOnly,
      })
      const pc = new RTCPeerConnection({
        iceServers: ICE_SERVERS,
        iceCandidatePoolSize: 10,
        bundlePolicy: 'max-bundle',
        ...(useRelayOnly ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy } : {}),
      })
      bindPeerEvents(pc)
      attachLocalTracks(pc)
      return pc
    }

    const replacePeerConnection = () => {
      pcRef.current?.close()
      pcRef.current = null
      iceSent = 0
      iceReceived = 0
      iceSkipped = 0
      pendingIce = []
      lastIceState = ''
      lastConnState = ''
      lastSigState = ''
      const pc = createPeerConnection()
      pcRef.current = pc
      return pc
    }

    const ensurePeerConnection = () => {
      if (!pcRef.current) {
        pcRef.current = createPeerConnection()
      }
      return pcRef.current
    }

    const sendOffer = async (iceRestart = false) => {
      const pc = ensurePeerConnection()
      attachLocalTracks(pc)
      makingOffer = true
      try {
        const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : undefined)
        await pc.setLocalDescription(offer)
        sendSignal({ type: 'offer', sdp: offer.sdp ?? '', from: playerId })
        diag('RTC', iceRestart ? 'ICE-restart offer created' : 'offer created', snapshot())
      } finally {
        makingOffer = false
      }
    }

    const attemptRecovery = async () => {
      if (!active || recovering || iceWasConnected || isIceConnected(pcRef.current)) return
      if (!peerPresent) return

      recovering = true
      try {
        if (!isHostRef.current) {
          diag('RTC', 'asking host to recover', snapshot())
          sendSignal({ type: 'hello', from: playerId })
          return
        }

        if (iceRestartCount >= MAX_ICE_RESTARTS) {
          diag('RTC', 'recovery limit reached', snapshot())
          setError('Video connection failed. Try leaving and rejoining.')
          return
        }

        iceRestartCount++

        if (iceRestartCount >= 2 && !useRelayOnly) {
          useRelayOnly = true
          diag('RTC', 'switching to TURN-only mode', snapshot())
          replacePeerConnection()
          await sendOffer(false)
          return
        }

        const pc = pcRef.current
        if (pc?.remoteDescription && pc.signalingState === 'stable') {
          diag('RTC', `ICE restart #${iceRestartCount}`, snapshot())
          await sendOffer(true)
          return
        }

        diag('RTC', `full re-offer #${iceRestartCount}`, snapshot())
        replacePeerConnection()
        await sendOffer(false)
      } finally {
        recovering = false
      }
    }

    const resendOffer = async () => {
      const pc = pcRef.current
      if (!pc) {
        await sendOffer(false)
        return
      }
      if (pc.remoteDescription) return
      attachLocalTracks(pc)
      if (pc.signalingState === 'stable') {
        await sendOffer(false)
        return
      }
      if (pc.localDescription?.type === 'offer') {
        sendSignal({
          type: 'offer',
          sdp: pc.localDescription.sdp ?? '',
          from: playerId,
        })
        diag('RTC', 'offer re-sent (same SDP)', snapshot())
      }
    }

    const handleHello = async () => {
      if (!isHostRef.current) return
      const pc = pcRef.current
      if (pc?.remoteDescription && !isIceConnected(pc)) {
        await attemptRecovery()
      } else {
        await resendOffer()
      }
    }

    const handleSignal = async (payload: SignalPayload) => {
      if (payload.from === playerId) return

      if (payload.type === 'ice') {
        iceReceived++
        if (iceReceived <= 3 || iceReceived % 10 === 0) {
          diag('RTC', `ICE received (${iceReceived})`, {
            from: payload.from,
            candidate: payload.candidate.candidate?.slice(0, 80),
            ...snapshot(),
          })
        }
      } else {
        diag('RTC', `received ${payload.type}`, { from: payload.from, ...snapshot() })
      }

      if (payload.type === 'hello') {
        peerPresent = true
        await handleHello()
        return
      }

      const pc = ensurePeerConnection()
      attachLocalTracks(pc)

      if (payload.type === 'offer') {
        peerPresent = true
        const polite = !isHostRef.current
        const offerCollision = makingOffer && polite
        if (offerCollision) {
          diag('RTC', 'IGNORED offer (collision)', snapshot())
          return
        }

        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
        await flushPendingIce(pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendSignal({ type: 'answer', sdp: answer.sdp ?? '', from: playerId })
        diag('RTC', 'answer created', snapshot())
        return
      }

      if (payload.type === 'answer' && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        await flushPendingIce(pc)
        diag('RTC', 'remote answer applied', snapshot())
        return
      }

      if (payload.type === 'answer' && pc.signalingState !== 'have-local-offer') {
        diag('RTC', 'answer IGNORED (wrong signaling state)', {
          state: pc.signalingState,
          ...snapshot(),
        })
        return
      }

      if (payload.type === 'ice' && payload.candidate) {
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(payload.candidate)
          } catch (err) {
            diag('RTC', 'ICE candidate add failed', { err, ...snapshot() })
          }
        } else {
          pendingIce.push(payload.candidate)
        }
      }
    }

    const enqueueSignal = (payload: SignalPayload) => {
      signalChain = signalChain
        .then(() => handleSignal(payload))
        .catch((err) => {
          diag('RTC', 'signal handler error', { err, type: payload.type, ...snapshot() })
          debugError('useWebRTC', 'signal handler failed', err)
        })
    }

    const ensureLocalStream = async () => {
      if (localStreamRef.current) return localStreamRef.current

      diag('RTC', 'requesting camera/mic')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: true,
      })

      if (!active) {
        stream.getTracks().forEach((t) => t.stop())
        return null
      }

      localStreamRef.current = stream
      setLocalStream(stream)
      diag('RTC', 'local camera ready', {
        streamId: stream.id,
        tracks: stream.getTracks().map((t) => t.kind),
      })
      return stream
    }

    const start = async () => {
      try {
        await ensureLocalStream()

        channel = client.channel(`webrtc:${lobbyId}`, {
          config: { broadcast: { self: false } },
        })

        channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
          enqueueSignal(payload as SignalPayload)
        })

        await channel.subscribe((status, err) => {
          channelReady = status === 'SUBSCRIBED'
          diag('RTC', 'signaling channel status', { status, err: err?.message, ...snapshot() })
          if (channelReady) flushOutbound()
        })

        sendSignal({ type: 'hello', from: playerId })

        if (isHostRef.current) {
          await sendOffer(false)
          offerRetryTimer = window.setInterval(() => {
            if (!active || !isHostRef.current || isIceConnected(pcRef.current)) return
            if (pcRef.current?.remoteDescription) return
            diag('RTC', 'retrying offer (waiting for opponent answer)', snapshot())
            void resendOffer()
          }, 3000)
        }
      } catch (err) {
        diag('RTC', 'start FAILED', { err, ...snapshot() })
        debugError('useWebRTC', 'start failed', err)
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Could not access camera or microphone',
          )
        }
      }
    }

    void start()

    return () => {
      diag('RTC', 'session cleanup', { lobbyId, playerId })
      active = false
      clearRecoveryTimer()
      if (offerRetryTimer != null) window.clearInterval(offerRetryTimer)
      pcRef.current?.close()
      pcRef.current = null
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
      remoteStreamRef.current = null
      setLocalStream(null)
      setRemoteStream(null)
      setConnected(false)
      void client.removeChannel(channel)
    }
  }, [lobbyId, playerId, enabled])

  return { localStream, remoteStream, connected, error }
}
