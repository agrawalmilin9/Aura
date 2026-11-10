'use client'

import { upload } from '@vercel/blob/client'

// Keep direct serverless uploads safely below Vercel's 4.5 MB request body limit
export const CLIENT_BLOB_THRESHOLD_BYTES = Math.floor(3.8 * 1024 * 1024)
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

function sanitizeClientTempFilename(name: string): string {
  const cleaned = (name || 'document.pdf')
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
  return cleaned || 'document.pdf'
}

/**
 * Uploads a document to AURA's /api/documents or /api/documents/preview endpoint.
 * - Files <= 3.8 MB (or local dev without Blob) use fast direct multipart upload.
 * - Files > 3.8 MB up to 10 MB in Vercel Blob cloud mode upload directly to a private temporary
 *   user-scoped Blob pathname via /api/documents/blob-token, then register via JSON.
 */
export async function postDocumentUpload(params: {
  endpoint: '/api/documents' | '/api/documents/preview'
  file: File
  categoryHint?: string
  reviewedMetadata?: Record<string, unknown>
}): Promise<Response> {
  const { endpoint, file, categoryHint, reviewedMetadata } = params

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File size exceeds the maximum allowed limit of 10 MB.')
  }

  if (file.size > CLIENT_BLOB_THRESHOLD_BYTES) {
    const tokenProbe = await fetch('/api/documents/blob-token', { cache: 'no-store' })
    const probeData = await tokenProbe.json().catch(() => null)

    if (tokenProbe.ok && probeData?.directBlobUploadSupported && typeof probeData.tempPrefix === 'string') {
      const safeName = sanitizeClientTempFilename(file.name)
      const pathname = `${probeData.tempPrefix}${Date.now()}_${safeName}`

      const blob = await upload(pathname, file, {
        access: 'private',
        handleUploadUrl: '/api/documents/blob-token',
        contentType: file.type || undefined,
      })

      return fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blobPathname: blob.pathname,
          originalFilename: file.name,
          mimeType: file.type,
          categoryHint,
          reviewedMetadata,
        }),
      })
    }
  }

  const formData = new FormData()
  formData.append('file', file)
  if (categoryHint) formData.append('categoryHint', categoryHint)
  if (reviewedMetadata) formData.append('reviewedMetadata', JSON.stringify(reviewedMetadata))

  return fetch(endpoint, {
    method: 'POST',
    body: formData,
  })
}
