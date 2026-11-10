'use client'

import { useState, useRef, useCallback } from 'react'
import type { IndicLanguageCode } from '../ai/types.ts'

export type AssistantState =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'error'

export interface ChatMessage {
  from: 'user' | 'aura'
  text: string
  sources?: Array<{
    documentId: string
    originalFilename: string
    documentType: string
    relevantField?: string
    fileUrl: string
  }>
  audioUrl?: string
  timestamp?: string
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1
  const bitDepth = 16
  const bytesPerSample = bitDepth / 8
  const dataLength = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true) // PCM audio format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true) // byte rate
  view.setUint16(32, numChannels * bytesPerSample, true) // block align
  view.setUint16(34, bitDepth, true) // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

async function convertBlobToWav(rawBlob: Blob): Promise<Blob> {
  if (typeof window === 'undefined') return rawBlob

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
  if (!AudioCtx) return rawBlob

  try {
    const audioCtx = new AudioCtx()
    const arrayBuffer = await rawBlob.arrayBuffer()
    const decoded = await audioCtx.decodeAudioData(arrayBuffer)

    let monoData: Float32Array
    if (decoded.numberOfChannels === 1) {
      monoData = decoded.getChannelData(0)
    } else {
      const ch0 = decoded.getChannelData(0)
      const ch1 = decoded.getChannelData(1)
      monoData = new Float32Array(ch0.length)
      for (let i = 0; i < ch0.length; i++) {
        monoData[i] = (ch0[i] + ch1[i]) / 2
      }
    }

    const wavBlob = encodeWav(monoData, decoded.sampleRate)
    await audioCtx.close().catch(() => {})
    return wavBlob
  } catch (err) {
    console.warn('WAV conversion fallback to original blob:', err)
    return rawBlob
  }
}

export function useVoiceAssistant(options?: {
  defaultLanguage?: IndicLanguageCode
  autoSpeakResponse?: boolean
}) {
  const defaultLanguage = options?.defaultLanguage || 'hi-IN'
  const autoSpeak = options?.autoSpeakResponse !== false

  const [state, setState] = useState<AssistantState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)

  // Stop currently playing speech audio
  const stopSpeaking = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current.currentTime = 0
      currentAudioRef.current = null
    }
    setState((prev) => (prev === 'speaking' ? 'idle' : prev))
  }, [])

  // Speak a text string using Gnani Timbre TTS
  const speakText = useCallback(
    async (text: string, languageCode: IndicLanguageCode = defaultLanguage) => {
      stopSpeaking()
      try {
        setState('speaking')
        const response = await fetch('/api/voice/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            language_code: languageCode,
            model: 'timbre-v2.5',
            voice: 'Nalini',
          }),
        })

        if (!response.ok) {
          const errData = await response.json().catch(() => null)
          throw new Error(errData?.error || `TTS synthesis failed (HTTP ${response.status})`)
        }

        const audioBlob = await response.blob()
        const url = URL.createObjectURL(audioBlob)
        setAudioUrl(url)

        const audio = new Audio(url)
        currentAudioRef.current = audio

        audio.onended = () => {
          setState('idle')
          currentAudioRef.current = null
        }

        audio.onerror = () => {
          setState('idle')
          currentAudioRef.current = null
        }

        await audio.play()
      } catch (err: any) {
        console.warn('Speech playback failed:', err)
        setState('idle')
      }
    },
    [defaultLanguage, stopSpeaking]
  )

  // Start recording audio from user's microphone
  const startRecording = useCallback(async () => {
    stopSpeaking()
    setErrorMessage(null)

    if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setErrorMessage('Microphone recording is not supported in this browser.')
      setState('error')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream

      // Select supported audio mime type
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        '',
      ].find((type) => (type ? MediaRecorder.isTypeSupported(type) : true)) || ''

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)

      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.start(100) // collect chunks every 100ms
      setState('recording')
    } catch (err: any) {
      console.error('Microphone access error:', err)
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Microphone access denied. Please grant permission in your browser.')
      } else {
        setErrorMessage(`Microphone error: ${err.message || 'Unable to access audio'}`)
      }
      setState('error')
    }
  }, [stopSpeaking])

  // Stop recording and process STT -> Reasoning -> TTS
  const stopRecordingAndProcess = useCallback(
    async (
      onTranscriptReady?: (transcript: string) => void,
      onReplyReady?: (reply: string, sources?: any[], memoryProposal?: any) => void,
      messagesHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
    ) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        return
      }

      return new Promise<void>((resolve) => {
        recorder.onstop = async () => {
          // Release microphone tracks
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop())
            streamRef.current = null
          }

          const mimeType = recorder.mimeType || 'audio/webm'
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
          audioChunksRef.current = []

          if (audioBlob.size < 500) {
            setErrorMessage('Audio clip was too short. Please try speaking again.')
            setState('idle')
            resolve()
            return
          }

          // 1. Transcribe with Gnani Prisma STT
          setState('transcribing')
          try {
            // Convert to 16kHz WAV format accepted by Gnani Prisma
            const wavBlob = await convertBlobToWav(audioBlob)

            const formData = new FormData()
            formData.append('audio_file', wavBlob, 'recording.wav')
            formData.append('language_code', defaultLanguage)
            formData.append('model', 'prisma-v2.5')

            const sttResponse = await fetch('/api/voice/stt', {
              method: 'POST',
              body: formData,
            })

            const sttData = await sttResponse.json()

            if (!sttResponse.ok || !sttData.success || !sttData.transcript?.trim()) {
              throw new Error(sttData?.error || 'Could not understand audio. Please speak clearly.')
            }

            const userText = sttData.transcript.trim()
            if (onTranscriptReady) {
              onTranscriptReady(userText)
            }

            // 2. Reason with AURA Reasoning Orchestrator (/api/chat)
            setState('thinking')
            const historyPayload = [
              ...(Array.isArray(messagesHistory) ? messagesHistory : []),
              { role: 'user' as const, content: userText },
            ]
            const chatResponse = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: userText,
                messages: historyPayload,
                language_code: sttData.detectedLanguageCode || defaultLanguage,
              }),
            })

            const chatData = await chatResponse.json()
            if (!chatResponse.ok || !chatData.success || !chatData.reply) {
              throw new Error(chatData?.error || 'AURA reasoning service unavailable.')
            }

            const assistantReply = chatData.reply.trim()
            if (onReplyReady) {
              onReplyReady(assistantReply, chatData.sources, chatData.memoryProposal || null)
            }

            // 3. Synthesize & play speech via Gnani Timbre TTS
            if (autoSpeak) {
              await speakText(assistantReply, sttData.detectedLanguageCode || defaultLanguage)
            } else {
              setState('idle')
            }
          } catch (err: any) {
            console.error('Voice pipeline error:', err)
            setErrorMessage(err.message || 'Voice processing failed.')
            setState('error')
          } finally {
            resolve()
          }
        }

        recorder.stop()
      })
    },
    [autoSpeak, defaultLanguage, speakText]
  )

  // Toggle recording button
  const toggleRecording = useCallback(
    (
      onTranscriptReady?: (transcript: string) => void,
      onReplyReady?: (reply: string, sources?: any[], memoryProposal?: any) => void,
      messagesHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
    ) => {
      if (state === 'recording') {
        stopRecordingAndProcess(onTranscriptReady, onReplyReady, messagesHistory)
      } else if (state === 'speaking') {
        stopSpeaking()
      } else {
        startRecording()
      }
    },
    [startRecording, state, stopRecordingAndProcess, stopSpeaking]
  )

  return {
    state,
    errorMessage,
    clearError: () => setErrorMessage(null),
    startRecording,
    stopRecordingAndProcess,
    toggleRecording,
    speakText,
    stopSpeaking,
    audioUrl,
  }
}
