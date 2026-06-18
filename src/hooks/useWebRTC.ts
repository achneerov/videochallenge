import { useEffect, useRef, useState } from 'react'
import { ICE_SERVERS } from '../lib/constants'
import { debug, debugError, debugWarn, diag } from '../lib/debug'
import { supabase } from '../lib/supabase'
import type { SignalPayload } from '../types'

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
  const hadRemoteMediaRef = useRef(false)
  const connectedRef = useRef(false)
  const peerPresentRef = useRef(false)
  const makingOffer = useRef(false)
  const ignoreOffer = useRef(false)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
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
    let signalChain = Promise.resolve()
    let channelReady = false
    let outboundQueue: SignalPayload[] = []
    let iceSent = 0
    let iceReceived = 0
    let lastIceState = ''
    let lastConnState = ''
    let lastSigState = ''

    setError(null)
    setRemoteStream(null)
    setConnected(false)
    connectedRef.current = false
    hadRemoteMediaRef.current = false
    peerPresentRef.current = false
    remoteStreamRef.current = null
    pendingIceRef.current = []

    const snapshot = () => ({
      isHost: isHostRef.current,
      channelReady,
      peerPresent: peerPresentRef.current,
      hadRemote: hadRemoteMediaRef.current,
      connected: connectedRef.current,
      signalingState: pcRef.current?.signalingState ?? 'none',
      iceState: pcRef.current?.iceConnectionState ?? 'none',
      connState: pcRef.current?.connectionState ?? 'none',
      pendingIce: pendingIceRef.current.length,
      queuedSignals: outboundQueue.length,
    })

    diag('RTC', 'session starting', { lobbyId, playerId, isHost })
    debug('useWebRTC', 'starting session', { lobbyId, playerId, isHost })

    const flushOutbound = () => {
      if (!channelReady || outboundQueue.length === 0) return
      const batch = outboundQueue
      outboundQueue = []
      for (const payload of batch) {
        void deliverSignal(payload)
      }
    }

    const deliverSignal = async (payload: SignalPayload) => {
      debug('useWebRTC', 'sendSignal', { type: payload.type, from: payload.from })
      try {
        if (channelReady) {
          const res = await channel.send({
            type: 'broadcast',
            event: 'signal',
            payload,
          })
          if (payload.type !== 'ice') {
            diag('RTC', `sent ${payload.type}`, { via: 'websocket', res, ...snapshot() })
          }
        } else {
          const res = await channel.httpSend('signal', payload)
          if (payload.type !== 'ice') {
            diag('RTC', `sent ${payload.type}`, { via: 'http', res, ...snapshot() })
          }
        }
      } catch (err) {
        diag('RTC', `send ${payload.type} FAILED`, { err, ...snapshot() })
        debugError('useWebRTC', 'sendSignal failed', err)
      }
    }

    const sendSignal = (payload: SignalPayload) => {
      if (payload.type === 'ice') {
        iceSent++
        if (iceSent === 1 || iceSent % 10 === 0) {
          diag('RTC', `ICE candidates sent (${iceSent})`, snapshot())
        }
      }
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
      const pending = pendingIceRef.current
      pendingIceRef.current = []
      if (pending.length > 0) {
        diag('RTC', `flushing ${pending.length} queued ICE candidates`, snapshot())
      }
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(candidate)
        } catch (err) {
          debugWarn('useWebRTC', 'queued ICE candidate failed', err)
        }
      }
    }

    const addRemoteTrack = (track: MediaStreamTrack) => {
      if (!active) return
      let stream = remoteStreamRef.current
      if (!stream) {
        stream = new MediaStream()
        remoteStreamRef.current = stream
      }
      if (!stream.getTracks().some((t) => t.id === track.id)) {
        stream.addTrack(track)
      }
      hadRemoteMediaRef.current = true
      connectedRef.current = true
      diag('RTC', 'remote track received', {
        kind: track.kind,
        streamId: stream.id,
        tracks: stream.getTracks().map((t) => t.kind),
      })
      debug('useWebRTC', 'remote track received', {
        kind: track.kind,
        streamId: stream.id,
        trackCount: stream.getTracks().length,
      })
      setRemoteStream(stream)
      setConnected(true)
    }

    const ensurePeerConnection = () => {
      if (pcRef.current) return pcRef.current

      diag('RTC', 'creating peer connection', { iceServers: ICE_SERVERS.length })
      debug('useWebRTC', 'creating RTCPeerConnection')
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pcRef.current = pc

      pc.onicecandidate = (event) => {
        if (event.candidate) {
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
        debug('useWebRTC', 'iceConnectionState', pc.iceConnectionState)
        if (pc.iceConnectionState === 'failed' && !hadRemoteMediaRef.current) {
          diag('RTC', 'ICE failed — host will retry offer', snapshot())
          debugWarn('useWebRTC', 'ICE failed before remote media — host will retry offer')
        }
      }

      pc.onsignalingstatechange = () => {
        if (pc.signalingState !== lastSigState) {
          lastSigState = pc.signalingState
          diag('RTC', 'signaling state', { state: pc.signalingState, ...snapshot() })
        }
        debug('useWebRTC', 'signalingState', pc.signalingState)
      }

      pc.ontrack = (event) => {
        const [stream] = event.streams
        if (stream) {
          remoteStreamRef.current = stream
          hadRemoteMediaRef.current = true
          connectedRef.current = true
          diag('RTC', 'remote stream received', {
            streamId: stream.id,
            tracks: stream.getTracks().map((t) => ({ kind: t.kind, readyState: t.readyState })),
          })
          debug('useWebRTC', 'remote stream received', { streamId: stream.id })
          setRemoteStream(stream)
          setConnected(true)
          return
        }
        addRemoteTrack(event.track)
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState !== lastConnState) {
          lastConnState = pc.connectionState
          diag('RTC', 'connection state', { state: pc.connectionState, ...snapshot() })
        }
        debug('useWebRTC', 'connectionState', pc.connectionState)
        if (pc.connectionState === 'connected') {
          connectedRef.current = true
          setConnected(true)
        }
        if (pc.connectionState === 'failed') {
          if (hadRemoteMediaRef.current) {
            diag('RTC', 'connection dropped after remote video had worked', snapshot())
            debugWarn('useWebRTC', 'connection dropped after remote media was flowing')
          } else if (peerPresentRef.current && active) {
            diag('RTC', 'CONNECTION FAILED — no remote video', snapshot())
            debugError('useWebRTC', 'peer connection FAILED before remote video')
            setError('Video connection failed. Try leaving and rejoining.')
          } else {
            diag('RTC', 'connection failed before opponent on signaling channel', snapshot())
            debugWarn('useWebRTC', 'connection failed before opponent joined signaling')
          }
        }
      }

      return pc
    }

    const attachLocalTracks = async (pc: RTCPeerConnection) => {
      if (localStreamRef.current) {
        const stream = localStreamRef.current
        const senders = pc.getSenders()
        for (const track of stream.getTracks()) {
          if (!senders.some((sender) => sender.track?.id === track.id)) {
            pc.addTrack(track, stream)
          }
        }
        return stream
      }

      diag('RTC', 'requesting camera/mic')
      debug('useWebRTC', 'requesting getUserMedia')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: true,
      })

      if (!active) {
        stream.getTracks().forEach((track) => track.stop())
        return null
      }

      localStreamRef.current = stream
      setLocalStream(stream)

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream)
      }

      diag('RTC', 'local camera ready', {
        streamId: stream.id,
        tracks: stream.getTracks().map((t) => t.kind),
      })
      debug('useWebRTC', 'local stream ready', { streamId: stream.id })
      return stream
    }

    const sendOffer = async () => {
      const pc = ensurePeerConnection()
      await attachLocalTracks(pc)
      makingOffer.current = true
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sendSignal({ type: 'offer', sdp: offer.sdp ?? '', from: playerId })
        diag('RTC', 'offer created', snapshot())
        debug('useWebRTC', 'offer sent')
      } finally {
        makingOffer.current = false
      }
    }

    const resendOffer = async () => {
      const pc = pcRef.current
      if (!pc) {
        diag('RTC', 'resend offer — no PC yet, creating')
        await sendOffer()
        return
      }
      await attachLocalTracks(pc)
      if (pc.signalingState === 'stable') {
        diag('RTC', 'resend offer — new negotiation')
        await sendOffer()
        return
      }
      if (pc.localDescription?.type === 'offer') {
        sendSignal({
          type: 'offer',
          sdp: pc.localDescription.sdp ?? '',
          from: playerId,
        })
        diag('RTC', 'offer re-sent (same SDP)', snapshot())
        debug('useWebRTC', 'offer re-sent')
      }
    }

    const handleSignal = async (payload: SignalPayload) => {
      if (payload.from === playerId) return

      if (payload.type === 'ice') {
        iceReceived++
        if (iceReceived === 1 || iceReceived % 10 === 0) {
          diag('RTC', `ICE candidates received (${iceReceived})`, { from: payload.from, ...snapshot() })
        }
      } else {
        diag('RTC', `received ${payload.type}`, { from: payload.from, ...snapshot() })
      }

      if (payload.type === 'hello') {
        peerPresentRef.current = true
        debug('useWebRTC', 'peer hello received', { from: payload.from })
        if (isHostRef.current) {
          await resendOffer()
        }
        return
      }

      const pc = ensurePeerConnection()
      await attachLocalTracks(pc)

      if (payload.type === 'offer') {
        peerPresentRef.current = true
        const offerCollision = makingOffer.current || pc.signalingState !== 'stable'
        ignoreOffer.current = !isHostRef.current && offerCollision
        if (ignoreOffer.current) {
          diag('RTC', 'IGNORED offer (collision)', snapshot())
          debugWarn('useWebRTC', 'ignored offer (collision)', { isHost: isHostRef.current })
          return
        }

        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
        await flushPendingIce(pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendSignal({ type: 'answer', sdp: answer.sdp ?? '', from: playerId })
        diag('RTC', 'answer created', snapshot())
        debug('useWebRTC', 'answer sent')
        return
      }

      if (payload.type === 'answer' && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        await flushPendingIce(pc)
        diag('RTC', 'remote answer applied', snapshot())
        debug('useWebRTC', 'remote answer applied')
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
            debugWarn('useWebRTC', 'ICE candidate failed', err)
          }
        } else {
          pendingIceRef.current.push(payload.candidate)
          if (pendingIceRef.current.length === 1 || pendingIceRef.current.length % 10 === 0) {
            diag('RTC', `ICE queued (${pendingIceRef.current.length}) — no remote description yet`, snapshot())
          }
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

    const announcePresence = () => {
      sendSignal({ type: 'hello', from: playerId })
    }

    const start = async () => {
      try {
        channel = client.channel(`webrtc:${lobbyId}`, {
          config: { broadcast: { self: false } },
        })

        channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
          enqueueSignal(payload as SignalPayload)
        })

        await channel.subscribe((status, err) => {
          channelReady = status === 'SUBSCRIBED'
          diag('RTC', 'signaling channel status', { status, err: err?.message, ...snapshot() })
          debug('useWebRTC', 'signaling channel', { status, err })
          if (channelReady) flushOutbound()
        })

        announcePresence()

        if (isHostRef.current) {
          await sendOffer()
          offerRetryTimer = window.setInterval(() => {
            if (!active || !isHostRef.current || connectedRef.current) return
            diag('RTC', 'retrying offer (not connected yet)', snapshot())
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
      debug('useWebRTC', 'cleanup session', { lobbyId, playerId })
      active = false
      if (offerRetryTimer != null) window.clearInterval(offerRetryTimer)
      pcRef.current?.close()
      pcRef.current = null
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
      localStreamRef.current = null
      remoteStreamRef.current = null
      hadRemoteMediaRef.current = false
      connectedRef.current = false
      peerPresentRef.current = false
      pendingIceRef.current = []
      setLocalStream(null)
      setRemoteStream(null)
      setConnected(false)
      void client.removeChannel(channel)
    }
  }, [lobbyId, playerId, enabled])

  return { localStream, remoteStream, connected, error }
}
