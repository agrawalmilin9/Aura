import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { getDocumentById, getDocumentFileBuffer, updateDocument, validateDocumentId } from '@/lib/lifefile/storage.ts'
import { extractDocumentWithGemini } from '@/lib/lifefile/gemini-extractor.ts'
import { syncTasksFromLifeFile } from '@/lib/tasks/storage.ts'
import { syncProductsFromLifeFile } from '@/lib/products/storage.ts'
import { syncContactsFromLifeFile } from '@/lib/contacts/storage.ts'

export const runtime = 'nodejs'
export const maxDuration = 60

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/documents/[id]/extract
 * Retries Gemini extraction on an existing stored document.
 */
export async function POST(req: NextRequest, context: RouteContext) {
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

    const fileData = await getDocumentFileBuffer(id, userId)
    if (!fileData) {
      return NextResponse.json({ success: false, error: 'Original document file is missing.' }, { status: 404 })
    }

    await updateDocument(id, { extractionStatus: 'processing' }, userId)
    const extraction = await extractDocumentWithGemini(
      fileData.buffer,
      fileData.mimeType,
      doc.extractedData?.userCategory || undefined
    )

    if (extraction.success && extraction.data) {
      const updated = await updateDocument(
        id,
        {
          extractionStatus: 'completed',
          extractedData: {
            ...extraction.data,
            userCategory: doc.extractedData?.userCategory || null,
          },
          extractionError: null,
        },
        userId
      )
      if (updated) {
        try {
          await syncTasksFromLifeFile([updated], userId)
          const syncedProds = await syncProductsFromLifeFile([updated], undefined, userId)
          await syncContactsFromLifeFile([updated], syncedProds.allProducts, undefined, userId)
        } catch (syncErr) {
          console.warn('Could not sync tasks/products/contacts after re-extraction:', syncErr)
        }
      }
      return NextResponse.json({ success: true, document: updated }, { status: 200 })
    } else {
      const updated = await updateDocument(
        id,
        {
          extractionStatus: 'failed',
          extractedData: null,
          extractionError: extraction.error || 'Extraction failed.',
        },
        userId
      )
      return NextResponse.json({ success: true, document: updated }, { status: 200 })
    }
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to reprocess extraction.' },
      { status: 500 }
    )
  }
}
