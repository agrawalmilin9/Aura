import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { getDocumentFileBuffer, validateDocumentId } from '@/lib/lifefile/storage.ts'

export const runtime = 'nodejs'
export const maxDuration = 30

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/documents/[id]/file
 * Streams the original uploaded document owned by the authenticated user.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateDocumentId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid document ID.' }, { status: 400 })
    }

    const fileData = await getDocumentFileBuffer(id, auth.user.id)
    if (!fileData) {
      return NextResponse.json({ success: false, error: 'File not found.' }, { status: 404 })
    }

    const { buffer, mimeType, originalFilename } = fileData
    const isDownload = req.nextUrl.searchParams.get('download') === '1'

    // Sanitize fallback ASCII filename and include RFC 5987 UTF-8 filename
    const asciiFallback = originalFilename.replace(/["\\\r\n;]/g, '_').replace(/[^\x20-\x7E]/g, '_') || 'document'
    const encodedFilename = encodeURIComponent(originalFilename)
    const dispositionType = isDownload ? 'attachment' : 'inline'

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': buffer.length.toString(),
        'Content-Disposition': `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to stream document file.' },
      { status: 500 }
    )
  }
}
