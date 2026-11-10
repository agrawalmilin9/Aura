import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { resolveUploadedDocumentFromRequest } from '@/lib/lifefile/upload-resolve.ts'
import { extractDocumentWithGemini } from '@/lib/lifefile/gemini-extractor.ts'
import { deletePrivateDocumentBlob } from '@/lib/storage/blob-storage.ts'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/documents/preview
 * Validates an uploaded document or camera capture (direct multipart or Private Blob ref > 4 MB)
 * and runs Gemini extraction for review BEFORE saving permanently.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  let tempBlobToClean: string | null = null

  try {
    const resolved = await resolveUploadedDocumentFromRequest(req, userId)
    if (!resolved.ok) return resolved.errorResponse

    const { buffer, validation, categoryHint } = resolved.data
    tempBlobToClean = resolved.data.tempBlobToClean

    const extraction = await extractDocumentWithGemini(
      buffer,
      validation.normalizedMimeType,
      categoryHint
    )

    if (!extraction.success || !extraction.data) {
      return NextResponse.json(
        {
          success: true,
          extractionStatus: 'failed',
          extractedData: null,
          extractionError: extraction.error || 'Could not extract details automatically.',
          sanitizedFilename: validation.sanitizedFilename,
          mimeType: validation.normalizedMimeType,
          fileSize: buffer.length,
        },
        { status: 200 }
      )
    }

    return NextResponse.json(
      {
        success: true,
        extractionStatus: 'completed',
        extractedData: {
          ...extraction.data,
          userCategory: categoryHint || null,
        },
        extractionError: null,
        sanitizedFilename: validation.sanitizedFilename,
        mimeType: validation.normalizedMimeType,
        fileSize: buffer.length,
      },
      { status: 200 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to analyze document: ${err?.message || 'Server error'}` },
      { status: 500 }
    )
  } finally {
    if (tempBlobToClean) {
      await deletePrivateDocumentBlob(tempBlobToClean, userId).catch(() => {})
    }
  }
}
