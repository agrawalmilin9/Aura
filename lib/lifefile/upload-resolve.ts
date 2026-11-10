import { NextRequest, NextResponse } from 'next/server'
import { MAX_DOCUMENT_FILE_SIZE, validateDocumentUpload } from './validation.ts'
import type { DocumentValidationResult } from './types.ts'
import { getStorageBackendMode } from '../storage/backend.ts'
import {
  assertValidPrivateBlobPathname,
  deletePrivateDocumentBlob,
  downloadPrivateDocumentBlob,
  headPrivateDocumentBlob,
} from '../storage/blob-storage.ts'

export interface ResolvedDocumentUpload {
  buffer: Buffer
  validation: DocumentValidationResult & {
    normalizedMimeType: string
    sanitizedFilename: string
  }
  categoryHint?: string
  reviewedMetadataRaw?: unknown
  tempBlobToClean: string | null
}

/**
 * Resolves either a direct multipart/form-data upload (<= 4.5 MB on Vercel)
 * or an authenticated large-file temporary Private Blob reference (up to 10 MB),
 * enforcing per-user path ownership, max size, MIME type, and actual file magic bytes.
 */
export async function resolveUploadedDocumentFromRequest(
  req: NextRequest,
  userId: string
): Promise<{ ok: true; data: ResolvedDocumentUpload } | { ok: false; errorResponse: NextResponse }> {
  const contentType = req.headers.get('content-type') || ''

  // 1. Direct multipart/form-data upload
  if (contentType.includes('multipart/form-data')) {
    const formData = await req.formData()
    const file = (formData.get('file') || formData.get('document')) as File | null
    const categoryHintRaw = formData.get('categoryHint')
    const categoryHint = typeof categoryHintRaw === 'string' ? categoryHintRaw.trim().slice(0, 80) : undefined
    const reviewedRaw = formData.get('reviewedMetadata')

    if (!file) {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { success: false, error: 'No file provided. Expected form field "file" or "document".' },
          { status: 400 }
        ),
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const validation = validateDocumentUpload(buffer, file.name, file.type)
    if (!validation.valid || !validation.normalizedMimeType || !validation.sanitizedFilename) {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { success: false, error: validation.error || 'Invalid document file.' },
          { status: 400 }
        ),
      }
    }

    let parsedReviewed: unknown = undefined
    if (typeof reviewedRaw === 'string' && reviewedRaw.trim()) {
      try {
        parsedReviewed = JSON.parse(reviewedRaw)
      } catch {
        parsedReviewed = undefined
      }
    }

    return {
      ok: true,
      data: {
        buffer,
        validation: {
          ...validation,
          normalizedMimeType: validation.normalizedMimeType,
          sanitizedFilename: validation.sanitizedFilename,
        },
        categoryHint,
        reviewedMetadataRaw: parsedReviewed,
        tempBlobToClean: null,
      },
    }
  }

  // 2. Authenticated large-file client Blob upload (JSON payload referencing user's temp private Blob)
  if (contentType.includes('application/json')) {
    if (getStorageBackendMode() !== 'cloud') {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { success: false, error: 'Client blob registration is only enabled when cloud Blob storage is configured.' },
          { status: 400 }
        ),
      }
    }

    const body = await req.json().catch(() => null)
    const rawBlobPath = typeof body?.blobPathname === 'string' ? body.blobPathname : ''
    const originalFilename = typeof body?.originalFilename === 'string' ? body.originalFilename : ''
    const mimeType = typeof body?.mimeType === 'string' ? body.mimeType : ''
    const categoryHint =
      typeof body?.categoryHint === 'string' ? body.categoryHint.trim().slice(0, 80) : undefined

    let safeBlobPath = ''
    try {
      safeBlobPath = assertValidPrivateBlobPathname(rawBlobPath, userId)
      if (!safeBlobPath.startsWith(`uploads/tmp/${userId}/`)) {
        throw new Error('Only user-scoped temporary upload blobs can be registered.')
      }
    } catch (err: any) {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { success: false, error: err?.message || 'Unauthorized blob pathname.' },
          { status: 403 }
        ),
      }
    }

    const meta = await headPrivateDocumentBlob(safeBlobPath, userId)
    if (!meta) {
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { success: false, error: 'Uploaded temporary file could not be found in private storage.' },
          { status: 404 }
        ),
      }
    }

    if (meta.size > MAX_DOCUMENT_FILE_SIZE) {
      await deletePrivateDocumentBlob(safeBlobPath, userId)
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { success: false, error: 'Uploaded file exceeds the maximum allowed limit of 10 MB.' },
          { status: 400 }
        ),
      }
    }

    const buffer = await downloadPrivateDocumentBlob(safeBlobPath, userId)
    if (!buffer) {
      await deletePrivateDocumentBlob(safeBlobPath, userId)
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { success: false, error: 'Could not read uploaded temporary file bytes for validation.' },
          { status: 400 }
        ),
      }
    }

    const validation = validateDocumentUpload(buffer, originalFilename || 'document.pdf', mimeType || meta.contentType)
    if (!validation.valid || !validation.normalizedMimeType || !validation.sanitizedFilename) {
      await deletePrivateDocumentBlob(safeBlobPath, userId)
      return {
        ok: false,
        errorResponse: NextResponse.json(
          { success: false, error: validation.error || 'Invalid document file signature or format.' },
          { status: 400 }
        ),
      }
    }

    return {
      ok: true,
      data: {
        buffer,
        validation: {
          ...validation,
          normalizedMimeType: validation.normalizedMimeType,
          sanitizedFilename: validation.sanitizedFilename,
        },
        categoryHint,
        reviewedMetadataRaw:
          body?.reviewedMetadata && typeof body.reviewedMetadata === 'object' ? body.reviewedMetadata : undefined,
        tempBlobToClean: safeBlobPath,
      },
    }
  }

  return {
    ok: false,
    errorResponse: NextResponse.json(
      {
        success: false,
        error: 'Content-Type must be multipart/form-data or application/json (blob reference).',
      },
      { status: 400 }
    ),
  }
}
