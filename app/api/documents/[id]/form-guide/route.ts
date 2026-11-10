import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import {
  getAllDocuments,
  getDocumentById,
  getDocumentFileBuffer,
  updateDocument,
  validateDocumentId,
} from '@/lib/lifefile/storage.ts'
import { getAllProducts } from '@/lib/products/storage.ts'
import { getAllContacts } from '@/lib/contacts/storage.ts'
import { getAllMemories } from '@/lib/memory/storage.ts'
import { analyzeFormPrefills, formatAnswerSheetText } from '@/lib/lifefile/form-assistant.ts'
import { inspectPdfAcroForm } from '@/lib/lifefile/pdf-form.ts'
import { recoverFormAnalysisForDocument } from '@/lib/lifefile/form-recovery.ts'
import { mergeExtractedMetadata } from '@/lib/lifefile/metadata-sanitize.ts'

export const runtime = 'nodejs'
export const maxDuration = 60

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/documents/[id]/form-guide
 * Computes step-by-step Form Filling Guide state with cross-document prefills and PDF fillable inspection.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  const auth = await requireApiAuth(req)
  if (auth.errorResponse) return auth.errorResponse
  const userId = auth.user.id

  try {
    const { id } = await context.params
    if (!validateDocumentId(id)) {
      return NextResponse.json({ success: false, error: 'Invalid document ID.' }, { status: 400 })
    }

    let formDoc = await getDocumentById(id, userId)
    if (!formDoc) {
      return NextResponse.json({ success: false, error: 'Document not found.' }, { status: 404 })
    }

    const forceReanalyze = req.nextUrl.searchParams.get('reanalyze') === '1'
    formDoc = await recoverFormAnalysisForDocument(formDoc, userId, { forceReanalyze })

    const [documents, products, contacts, memories, fileData] = await Promise.all([
      getAllDocuments(userId),
      getAllProducts(userId),
      getAllContacts(userId),
      getAllMemories(userId),
      formDoc.mimeType === 'application/pdf' ? getDocumentFileBuffer(id, userId) : Promise.resolve(null),
    ])

    const formState = analyzeFormPrefills({
      formDoc,
      documents,
      products,
      contacts,
      memories,
      userProfile: {
        name: auth.user.name,
        email: auth.user.email,
        phone: auth.user.phone,
      },
    })

    const pdfInspection = fileData
      ? await inspectPdfAcroForm(fileData.buffer)
      : { isPdf: false, hasFillableFields: false, fields: [] }

    return NextResponse.json(
      {
        success: true,
        formState,
        pdfInspection,
        answerSheetText: formatAnswerSheetText(formState),
      },
      { status: 200 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to analyze form guide.' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/documents/[id]/form-guide
 * Persists user-confirmed and manually entered answers inside extractedData.formAnalysis.savedAnswers.
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
    const rawAnswers = body?.savedAnswers ?? body?.answers
    if (!body || typeof rawAnswers !== 'object' || rawAnswers === null || Array.isArray(rawAnswers)) {
      return NextResponse.json(
        { success: false, error: 'savedAnswers object is required.' },
        { status: 400 }
      )
    }

    const nextExtracted = mergeExtractedMetadata(existing.extractedData, {
      savedFormAnswers: rawAnswers,
    })

    const updated = await updateDocument(
      id,
      {
        extractedData: nextExtracted,
      },
      userId
    )

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Failed to save form answers.' }, { status: 500 })
    }

    const [documents, products, contacts, memories] = await Promise.all([
      getAllDocuments(userId),
      getAllProducts(userId),
      getAllContacts(userId),
      getAllMemories(userId),
    ])

    const formState = analyzeFormPrefills({
      formDoc: updated,
      documents,
      products,
      contacts,
      memories,
      userProfile: {
        name: auth.user.name,
        email: auth.user.email,
        phone: auth.user.phone,
      },
    })

    return NextResponse.json(
      {
        success: true,
        document: updated,
        formState,
        answerSheetText: formatAnswerSheetText(formState),
      },
      { status: 200 }
    )
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to save form answers.' },
      { status: 500 }
    )
  }
}
