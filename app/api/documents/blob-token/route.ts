import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { getStorageBackendMode } from '@/lib/storage/backend.ts'
import { assertValidPrivateBlobPathname, buildUserTempUploadPrefix } from '@/lib/storage/blob-storage.ts'
import { MAX_DOCUMENT_FILE_SIZE, SUPPORTED_MIME_TYPES } from '@/lib/lifefile/validation.ts'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * GET /api/documents/blob-token
 * Reports whether authenticated direct Private Blob uploads (>4 MB up to 10 MB) are active
 * and returns the user's scoped temporary upload prefix.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  const mode = getStorageBackendMode()
  return NextResponse.json(
    {
      success: true,
      mode,
      directBlobUploadSupported: mode === 'cloud',
      maxFileSize: MAX_DOCUMENT_FILE_SIZE,
      tempPrefix: mode === 'cloud' ? buildUserTempUploadPrefix(auth.user.id) : null,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  )
}

/**
 * POST /api/documents/blob-token
 * Issues short-lived, user-scoped Private Vercel Blob client upload tokens so files
 * between 4 MB and 10 MB bypass Vercel's 4.5 MB function request-body limit safely.
 */
export async function POST(req: NextRequest) {
  let mode: 'local' | 'cloud'
  try {
    mode = getStorageBackendMode()
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Storage configuration error.' }, { status: 500 })
  }

  if (mode !== 'cloud') {
    return NextResponse.json(
      { success: false, error: 'Direct Blob upload tokens require cloud storage configuration.' },
      { status: 501 }
    )
  }

  const body = (await req.json().catch(() => null)) as HandleUploadBody | null
  if (!body || typeof body !== 'object' || !('type' in body)) {
    return NextResponse.json({ success: false, error: 'Invalid upload token request body.' }, { status: 400 })
  }

  let authenticatedUserId: string | undefined

  if (body.type !== 'blob.upload-completed') {
    const auth = await requireApiAuth(req)
    if (auth.errorResponse) return auth.errorResponse
    authenticatedUserId = auth.user.id
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!authenticatedUserId) {
          throw new Error('Authentication required to issue upload token.')
        }
        const safePath = assertValidPrivateBlobPathname(pathname, authenticatedUserId)
        if (!safePath.startsWith(buildUserTempUploadPrefix(authenticatedUserId))) {
          throw new Error('Upload path must stay within the authenticated user temporary prefix.')
        }

        return {
          allowedContentTypes: [...SUPPORTED_MIME_TYPES],
          maximumSizeInBytes: MAX_DOCUMENT_FILE_SIZE,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 5 * 60 * 1000, // 5 minute token lifetime
        }
      },
      onUploadCompleted: async () => {
        // Explicit validation and registration occurs cleanly in POST /api/documents
      },
    })

    return NextResponse.json(jsonResponse, { status: 200 })
  } catch (err: any) {
    const message = err?.message || 'Could not authorize client upload.'
    const status = /unauthorized|authentication|scope|prefix/i.test(message) ? 403 : 400
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
