import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import { resolveUploadedDocumentFromRequest } from '@/lib/lifefile/upload-resolve.ts'
import { saveDocument, getAllDocuments, updateDocument } from '@/lib/lifefile/storage.ts'
import { extractDocumentWithGemini } from '@/lib/lifefile/gemini-extractor.ts'
import { mergeExtractedMetadata } from '@/lib/lifefile/metadata-sanitize.ts'
import { syncTasksFromLifeFile } from '@/lib/tasks/storage.ts'
import { syncProductsFromLifeFile } from '@/lib/products/storage.ts'
import { syncContactsFromLifeFile } from '@/lib/contacts/storage.ts'
import { deletePrivateDocumentBlob } from '@/lib/storage/blob-storage.ts'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/documents
 * Lists all uploaded documents belonging to the authenticated user.
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse

  try {
    const docs = await getAllDocuments(auth.user.id)
    return NextResponse.json({ success: true, documents: docs }, { status: 200 })
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to retrieve documents.' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/documents
 * Accepts either multipart upload or an authenticated Private Blob reference (>4 MB up to 10 MB),
 * validates file signature, saves to user-scoped LifeFile storage, and extracts/syncs metadata.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  let tempBlobToClean: string | null = null

  try {
    const resolved = await resolveUploadedDocumentFromRequest(req, userId)
    if (!resolved.ok) return resolved.errorResponse

    const { buffer, validation, categoryHint, reviewedMetadataRaw } = resolved.data
    tempBlobToClean = resolved.data.tempBlobToClean

    const storedDoc = await saveDocument(
      buffer,
      validation.sanitizedFilename,
      validation.normalizedMimeType,
      userId
    )

    // If user already reviewed & edited extracted fields in Guided Upload, save directly
    if (reviewedMetadataRaw && typeof reviewedMetadataRaw === 'object') {
      try {
        const sanitized = mergeExtractedMetadata(null, {
          ...(reviewedMetadataRaw as Record<string, unknown>),
          userCategory: categoryHint || (reviewedMetadataRaw as any)?.userCategory || null,
        })
        const finalDoc = await updateDocument(
          storedDoc.id,
          {
            extractionStatus: 'completed',
            extractedData: sanitized,
            extractionError: null,
          },
          userId
        )
        if (finalDoc) {
          try {
            await syncTasksFromLifeFile([finalDoc], userId)
            const syncedProds = await syncProductsFromLifeFile([finalDoc], undefined, userId)
            await syncContactsFromLifeFile([finalDoc], syncedProds.allProducts, undefined, userId)
          } catch (syncErr) {
            console.warn('Could not auto-sync tasks/products/contacts from uploaded document:', syncErr)
          }
        }
        return NextResponse.json({ success: true, document: finalDoc }, { status: 201 })
      } catch {
        // Fall through to Gemini extraction if reviewed metadata could not be applied
      }
    }

    // Trigger Gemini multimodal extraction (with PDF printed/OCR fallback)
    try {
      await updateDocument(storedDoc.id, { extractionStatus: 'processing' }, userId)
      const extraction = await extractDocumentWithGemini(
        buffer,
        validation.normalizedMimeType,
        categoryHint
      )

      if (extraction.success && extraction.data) {
        const finalDoc = await updateDocument(
          storedDoc.id,
          {
            extractionStatus: 'completed',
            extractedData: {
              ...extraction.data,
              userCategory: categoryHint || null,
            },
            extractionError: null,
          },
          userId
        )
        if (finalDoc) {
          try {
            await syncTasksFromLifeFile([finalDoc], userId)
            const syncedProds = await syncProductsFromLifeFile([finalDoc], undefined, userId)
            await syncContactsFromLifeFile([finalDoc], syncedProds.allProducts, undefined, userId)
          } catch (syncErr) {
            console.warn('Could not auto-sync tasks/products/contacts from uploaded document:', syncErr)
          }
        }
        return NextResponse.json({ success: true, document: finalDoc }, { status: 201 })
      } else {
        const finalDoc = await updateDocument(
          storedDoc.id,
          {
            extractionStatus: 'failed',
            extractedData: null,
            extractionError: extraction.error || 'Extraction failed.',
          },
          userId
        )
        return NextResponse.json({ success: true, document: finalDoc }, { status: 201 })
      }
    } catch (extErr: any) {
      const finalDoc = await updateDocument(
        storedDoc.id,
        {
          extractionStatus: 'failed',
          extractedData: null,
          extractionError: extErr?.message || 'Unexpected extraction failure.',
        },
        userId
      )
      return NextResponse.json({ success: true, document: finalDoc }, { status: 201 })
    }
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: `Unexpected server error during document upload: ${err?.message || 'Unknown error'}`,
      },
      { status: 500 }
    )
  } finally {
    if (tempBlobToClean) {
      await deletePrivateDocumentBlob(tempBlobToClean, userId).catch(() => {})
    }
  }
}
