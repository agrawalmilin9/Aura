import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/auth/session.ts'
import {
  getAllDocuments,
  getDocumentById,
  getDocumentFileBuffer,
  validateDocumentId,
} from '@/lib/lifefile/storage.ts'
import { getAllProducts } from '@/lib/products/storage.ts'
import { getAllContacts } from '@/lib/contacts/storage.ts'
import { getAllMemories } from '@/lib/memory/storage.ts'
import { analyzeFormPrefills, formatAnswerSheetText } from '@/lib/lifefile/form-assistant.ts'
import { fillPdfAcroForm } from '@/lib/lifefile/pdf-form.ts'

export const runtime = 'nodejs'
export const maxDuration = 60

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/documents/[id]/filled-form
 * Safely populates interactive AcroForm PDF fields when supported and explicitly approved by the user.
 * Never fabricates coordinate overlays onto flat scanned PDFs or images.
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

    const body = await req.json().catch(() => null)
    if (!body || body.explicitApproval !== true) {
      return NextResponse.json(
        {
          success: false,
          error: 'Explicit user confirmation (explicitApproval: true) is required before generating a filled PDF.',
        },
        { status: 400 }
      )
    }

    const formDoc = await getDocumentById(id, userId)
    if (!formDoc) {
      return NextResponse.json({ success: false, error: 'Document not found.' }, { status: 404 })
    }

    const [documents, products, contacts, memories, fileData] = await Promise.all([
      getAllDocuments(userId),
      getAllProducts(userId),
      getAllContacts(userId),
      getAllMemories(userId),
      getDocumentFileBuffer(id, userId),
    ])

    if (!fileData) {
      return NextResponse.json({ success: false, error: 'Original file buffer not found.' }, { status: 404 })
    }

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

    // Collect only confirmed/saved entries or safe verified available prefills
    const answersByFieldName: Record<string, string> = {}
    for (const f of formState.fields) {
      if (f.savedValue && (!f.needsUserConfirmation || f.confirmed)) {
        answersByFieldName[f.fieldName] = f.savedValue
      } else if (f.prefilledValue && f.status === 'available' && !f.isSensitive) {
        answersByFieldName[f.fieldName] = f.prefilledValue
      }
    }

    if (formDoc.mimeType !== 'application/pdf') {
      return NextResponse.json(
        {
          success: false,
          fillable: false,
          message:
            'Image forms cannot be safely auto-filled onto pixel coordinates. Use the copyable or downloadable Answer Sheet instead.',
          answerSheetText: formatAnswerSheetText(formState),
        },
        { status: 422 }
      )
    }

    const pdfFillResult = await fillPdfAcroForm(fileData.buffer, answersByFieldName)
    if (!pdfFillResult.fillable || !pdfFillResult.pdfBytes || pdfFillResult.filledCount === 0) {
      return NextResponse.json(
        {
          success: false,
          fillable: false,
          message:
            'This PDF does not contain interactive fillable form fields (it is a flat or scanned PDF). Use the structured Answer Sheet to complete it safely.',
          answerSheetText: formatAnswerSheetText(formState),
        },
        { status: 422 }
      )
    }

    const baseName = formDoc.originalFilename.replace(/\.pdf$/i, '')
    const outName = `filled-${baseName}.pdf`
    const asciiFallback = outName.replace(/["\\\r\n;]/g, '_').replace(/[^\x20-\x7E]/g, '_') || 'filled-form.pdf'
    const encodedName = encodeURIComponent(outName)

    return new NextResponse(new Uint8Array(pdfFillResult.pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': pdfFillResult.pdfBytes.byteLength.toString(),
        'Content-Disposition': `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`,
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to generate filled PDF.' },
      { status: 500 }
    )
  }
}
