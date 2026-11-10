import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { getDocumentById, updateDocument, deleteDocument, validateDocumentId } from '@/lib/lifefile/storage.ts'
import { mergeExtractedMetadata } from '@/lib/lifefile/metadata-sanitize.ts'
import { syncTasksFromLifeFile } from '@/lib/tasks/storage.ts'
import { syncProductsFromLifeFile } from '@/lib/products/storage.ts'
import { syncContactsFromLifeFile } from '@/lib/contacts/storage.ts'

export const runtime = 'nodejs'
export const maxDuration = 30

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/documents/[id]
 * Retrieves metadata for a single stored document owned by the authenticated user.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const { id } = await context.params
    if (!validateDocumentId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid document ID.' }, { status: 400 })
    }

    const doc = await getDocumentById(id, auth.user.id)
    if (!doc) {
      return NextResponse.json({ success: false, error: 'Document not found.' }, { status: 404 })
    }

    return NextResponse.json({ success: true, document: doc }, { status: 200 })
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve document metadata.' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/documents/[id]
 * Allows editing document metadata / extracted fields safely and marks extraction as completed.
 */
export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const { id } = await context.params
    if (!validateDocumentId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid document ID.' }, { status: 400 })
    }

    const existing = await getDocumentById(id, userId)
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Document not found.' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ success: false, error: 'Invalid JSON request body.' }, { status: 400 })
    }

    const extInput = body.extractedData && typeof body.extractedData === 'object' ? body.extractedData : body
    const nextExtracted = mergeExtractedMetadata(existing.extractedData, extInput)

    const updated = await updateDocument(
      id,
      {
        originalFilename:
          typeof body.originalFilename === 'string' && body.originalFilename.trim()
            ? body.originalFilename.replace(/[/\\]/g, '').trim()
            : existing.originalFilename,
        extractionStatus: 'completed',
        extractedData: nextExtracted,
        extractionError: null,
      },
      userId
    )

    if (updated) {
      try {
        await syncTasksFromLifeFile([updated], userId)
        const syncedProds = await syncProductsFromLifeFile([updated], undefined, userId)
        await syncContactsFromLifeFile([updated], syncedProds.allProducts, undefined, userId)
      } catch {}
    }

    return NextResponse.json({ success: true, document: updated }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: `Failed to update document metadata: ${err?.message || err}` },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/documents/[id]
 * Deletes document file and removes its persistent metadata.
 */
export async function DELETE(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const { id } = await context.params
    if (!validateDocumentId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid document ID.' }, { status: 400 })
    }

    const doc = await getDocumentById(id, userId)
    if (!doc) {
      return NextResponse.json({ success: false, error: 'Document not found.' }, { status: 404 })
    }

    const deleted = await deleteDocument(id, userId)
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Failed to delete document.' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, message: 'Document deleted successfully.' }, { status: 200 })
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to process document deletion.' },
      { status: 500 }
    )
  }
}
