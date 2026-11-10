'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Camera,
  Check,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Upload,
  X,
} from 'lucide-react'

interface CameraCaptureModalProps {
  open: boolean
  onClose: () => void
  onAcceptFile: (file: File) => void
  onFallbackUpload?: () => void
}

async function renderRotatedJpeg(sourceUrl: string, rotationDeg: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const swapAxes = rotationDeg % 180 !== 0
      const w = swapAxes ? img.height : img.width
      const h = swapAxes ? img.width : img.height
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context unavailable.'))
        return
      }
      ctx.translate(w / 2, h / 2)
      ctx.rotate((rotationDeg * Math.PI) / 180)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }
    img.onerror = () => reject(new Error('Could not rotate captured image.'))
    img.src = sourceUrl
  })
}

async function stitchCapturedPagesToFile(dataUrls: string[]): Promise<File> {
  if (dataUrls.length === 0) {
    throw new Error('No captured photo to convert.')
  }

  const images = await Promise.all(
    dataUrls.map(
      (url) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('Failed to load captured page.'))
          img.src = url
        })
    )
  )

  const maxWidth = Math.min(1800, Math.max(...images.map((i) => i.width)))
  const scaledHeights = images.map((i) => Math.round((i.height * maxWidth) / i.width))
  const dividerGap = images.length > 1 ? 16 : 0
  const totalHeight =
    scaledHeights.reduce((sum, h) => sum + h, 0) + dividerGap * (images.length - 1)

  const canvas = document.createElement('canvas')
  canvas.width = maxWidth
  canvas.height = totalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable while creating file.')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, maxWidth, totalHeight)

  let offsetY = 0
  for (let i = 0; i < images.length; i++) {
    ctx.drawImage(images[i], 0, offsetY, maxWidth, scaledHeights[i])
    offsetY += scaledHeights[i] + dividerGap
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
  )
  if (!blob) throw new Error('Failed to encode captured document image.')

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return new File([blob], `camera-document-${stamp}.jpg`, { type: 'image/jpeg' })
}

export function CameraCaptureModal({
  open,
  onClose,
  onAcceptFile,
  onFallbackUpload,
}: CameraCaptureModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const [cameraStatus, setCameraStatus] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const [capturedPages, setCapturedPages] = useState<string[]>([])
  const [draftShot, setDraftShot] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop()
        } catch {}
      }
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const startCamera = useCallback(
    async (preferredFacing: 'environment' | 'user') => {
      stopTracks()
      setErrorMessage(null)
      setCameraStatus('starting')

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraStatus('error')
        setErrorMessage(
          'Camera capture is unavailable in this browser or context (HTTPS or localhost is required). Please upload a document file instead.'
        )
        return
      }

      try {
        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: preferredFacing },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          })
        } catch {
          // Fallback to any available video device (e.g. desktop webcam without facingMode)
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          })
        }

        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setCameraStatus('ready')
      } catch (err: any) {
        setCameraStatus('error')
        const errName = err?.name || ''
        if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
          setErrorMessage(
            'Camera permission was denied. Allow camera access in your browser settings or upload a file instead.'
          )
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          setErrorMessage(
            'No camera was detected on this device. Use normal file upload instead.'
          )
        } else {
          setErrorMessage(
            err?.message || 'Could not start camera preview. Please upload a file instead.'
          )
        }
      }
    },
    [stopTracks]
  )

  useEffect(() => {
    if (!open) {
      stopTracks()
      setCapturedPages([])
      setDraftShot(null)
      setErrorMessage(null)
      setCameraStatus('idle')
      return
    }

    startCamera(facingMode)

    const handlePageHide = () => stopTracks()
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      stopTracks()
    }
  }, [open, facingMode, startCamera, stopTracks])

  if (!open) return null

  const handleCapture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      setErrorMessage('Camera stream is not ready yet. Please wait a moment and try again.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setDraftShot(dataUrl)
  }

  const handleRotateDraft = async () => {
    if (!draftShot) return
    try {
      const rotated = await renderRotatedJpeg(draftShot, 90)
      setDraftShot(rotated)
    } catch {}
  }

  const handleAddAnotherPage = () => {
    if (!draftShot) return
    setCapturedPages((prev) => [...prev, draftShot])
    setDraftShot(null)
  }

  const handleAccept = async () => {
    const allPages = draftShot ? [...capturedPages, draftShot] : [...capturedPages]
    if (allPages.length === 0) return

    setIsProcessing(true)
    try {
      const file = await stitchCapturedPagesToFile(allPages)
      stopTracks()
      onAcceptFile(file)
      onClose()
    } catch (err: any) {
      setErrorMessage(err?.message || 'Could not prepare captured document photo.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(18, 17, 15, 0.72)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '12px',
      }}
      onClick={() => {
        stopTracks()
        onClose()
      }}
    >
      <div
        className="panel"
        style={{
          width: 'min(640px, 100%)',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: '14px',
          padding: '20px',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px',
          }}
        >
          <div>
            <span className="section-kicker">DOCUMENT CAMERA CAPTURE</span>
            <h3 style={{ margin: '2px 0 0', fontSize: '17px' }}>
              {draftShot
                ? `Review captured photo${capturedPages.length > 0 ? ` (Page ${capturedPages.length + 1})` : ''}`
                : 'Position your document in the frame'}
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              stopTracks()
              onClose()
            }}
            aria-label="Close camera"
            style={{ background: 'none', border: 'none', color: '#6b675f', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {capturedPages.length > 0 && (
          <div
            style={{
              padding: '8px 12px',
              background: '#eef7f0',
              borderRadius: '8px',
              fontSize: '12px',
              color: '#3f764d',
              marginBottom: '12px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{capturedPages.length} page(s) captured and ready to combine.</span>
            {!draftShot && (
              <button
                type="button"
                className="outline-button"
                style={{ padding: '4px 9px', fontSize: '11px' }}
                onClick={handleAccept}
                disabled={isProcessing}
              >
                Finish &amp; Extract ({capturedPages.length})
              </button>
            )}
          </div>
        )}

        {errorMessage && (
          <div
            style={{
              padding: '14px',
              background: '#fae9e5',
              border: '1px solid #f0d4cc',
              borderRadius: '10px',
              color: '#b85343',
              fontSize: '13px',
              marginBottom: '14px',
            }}
          >
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '10px' }}>
              <AlertCircle size={17} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{errorMessage}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="outline-button"
                onClick={() => startCamera(facingMode)}
                style={{ fontSize: '12px', background: '#fff' }}
              >
                <RefreshCw size={13} /> Retry Camera
              </button>
              {onFallbackUpload && (
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    stopTracks()
                    onClose()
                    onFallbackUpload()
                  }}
                  style={{ fontSize: '12px' }}
                >
                  <Upload size={13} /> Upload File Instead
                </button>
              )}
            </div>
          </div>
        )}

        {!draftShot ? (
          <div>
            <div
              style={{
                position: 'relative',
                width: '100%',
                minHeight: '260px',
                maxHeight: '55vh',
                background: '#171715',
                borderRadius: '10px',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {cameraStatus === 'starting' && (
                <div style={{ position: 'absolute', color: '#f5f4ef', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Loader2 size={16} className="animate-spin" /> Starting camera...
                </div>
              )}
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                style={{
                  width: '100%',
                  maxHeight: '55vh',
                  objectFit: 'contain',
                  display: cameraStatus === 'error' ? 'none' : 'block',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                marginTop: '14px',
              }}
            >
              <button
                type="button"
                className="outline-button"
                onClick={() => setFacingMode((m) => (m === 'environment' ? 'user' : 'environment'))}
                disabled={cameraStatus === 'starting'}
                style={{ minHeight: '42px' }}
              >
                <RefreshCw size={14} /> Switch Camera
              </button>

              <button
                type="button"
                className="primary-button"
                onClick={handleCapture}
                disabled={cameraStatus !== 'ready'}
                style={{ minHeight: '44px', padding: '0 20px', fontSize: '13px' }}
              >
                <Camera size={16} /> Capture Photo
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: '#171715',
                borderRadius: '10px',
                padding: '10px',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              <img
                src={draftShot}
                alt="Captured document preview"
                style={{ maxWidth: '100%', maxHeight: '52vh', objectFit: 'contain', borderRadius: '6px' }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                marginTop: '14px',
              }}
            >
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => setDraftShot(null)}
                  disabled={isProcessing}
                  style={{ minHeight: '40px' }}
                >
                  Retake
                </button>
                <button
                  type="button"
                  className="outline-button"
                  onClick={handleRotateDraft}
                  disabled={isProcessing}
                  style={{ minHeight: '40px' }}
                >
                  <RotateCw size={14} /> Rotate 90°
                </button>
                <button
                  type="button"
                  className="outline-button"
                  onClick={handleAddAnotherPage}
                  disabled={isProcessing}
                  style={{ minHeight: '40px' }}
                >
                  <Plus size={14} /> Add Page
                </button>
              </div>

              <button
                type="button"
                className="primary-button"
                onClick={handleAccept}
                disabled={isProcessing}
                style={{ minHeight: '42px', padding: '0 18px' }}
              >
                {isProcessing ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Preparing...
                  </>
                ) : (
                  <>
                    <Check size={15} /> Accept &amp; Extract
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
