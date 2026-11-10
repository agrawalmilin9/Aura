import type { StoredDocument, ExtractedDocumentData, FormDetectionMethod, FormFieldSpec } from './types.ts'
import { getDocumentFileBuffer, updateDocument } from './storage.ts'
import {
  buildFieldSpecFromLabel,
  dedupeFormFields,
  extractPdfPrintedText,
  inspectPdfAcroForm,
} from './pdf-form.ts'
import { extractDocumentWithGemini } from './gemini-extractor.ts'
import { looksLikeFormDocument } from './form-assistant.ts'

/**
 * Determines whether an existing stored document appears to be a form missing extracted fields
 * (e.g., an older blank PDF uploaded before printed/visual field detection or saved without formAnalysis).
 */
export function needsFormFieldRecovery(doc: StoredDocument): boolean {
  if (doc.mimeType !== 'application/pdf') return false
  if (!looksLikeFormDocument(doc)) return false
  const hasSavedFields = Boolean(doc.extractedData?.formAnalysis?.fields?.length)
  return !doc.extractedData?.isForm || !hasSavedFields
}

/**
 * Re-inspects a PDF document using AcroForm, printed PDF text layout, and Gemini multimodal +
 * page-by-page Vision/OCR, then persists the recovered formAnalysis back into user-scoped storage.
 */
export async function recoverFormAnalysisForDocument(
  doc: StoredDocument,
  userId?: string,
  options?: { forceReanalyze?: boolean }
): Promise<StoredDocument> {
  if (!options?.forceReanalyze && !needsFormFieldRecovery(doc)) {
    return doc
  }
  if (doc.mimeType !== 'application/pdf') {
    return doc
  }

  const fileData = await getDocumentFileBuffer(doc.id, userId)
  if (!fileData) return doc

  const [acro, printed] = await Promise.all([
    inspectPdfAcroForm(fileData.buffer),
    extractPdfPrintedText(fileData.buffer),
  ])

  const geminiRes = await extractDocumentWithGemini(
    fileData.buffer,
    fileData.mimeType,
    doc.extractedData?.userCategory || undefined
  )

  let nextExtracted: ExtractedDocumentData | null = null

  if (geminiRes.success && geminiRes.data && (geminiRes.data.formAnalysis?.fields?.length || 0) > 0) {
    nextExtracted = {
      ...doc.extractedData,
      ...geminiRes.data,
      userCategory: doc.extractedData?.userCategory || geminiRes.data.userCategory || null,
      formAnalysis: geminiRes.data.formAnalysis
        ? {
            ...geminiRes.data.formAnalysis,
            ...(doc.extractedData?.formAnalysis?.savedAnswers
              ? { savedAnswers: doc.extractedData.formAnalysis.savedAnswers }
              : {}),
          }
        : null,
    }
  } else {
    // Deterministic fallback combining interactive AcroForm fields and extracted printed labels
    const acroSpecs: FormFieldSpec[] = acro.fields.map((f, idx) =>
      buildFieldSpecFromLabel({
        fieldNumber: idx + 1,
        fieldName: f.name,
        fieldType: f.type,
        options: f.options,
      })
    )
    const fallbackFields = dedupeFormFields([...acroSpecs, ...printed.candidateFields])

    if (fallbackFields.length > 0 || acro.hasFillableFields || looksLikeFormDocument(doc)) {
      const methods: FormDetectionMethod[] = []
      if (acro.hasFillableFields) methods.push('acroform')
      if (printed.totalChars > 0) methods.push('pdf_text')

      const base = doc.extractedData || geminiRes.data
      const formTitle =
        base?.formAnalysis?.formTitle ||
        base?.documentTitle ||
        doc.originalFilename.replace(/\.[^.]+$/, '')

      const formDetectionNote =
        fallbackFields.length === 0
          ? printed.isLikelyScanned
            ? `This PDF appears scanned/image-based (${printed.pageCount} page(s)) and automatic OCR/visual field extraction could not confirm labels (${geminiRes.error || 'AI unavailable'}). Please upload a clearer scan or photo.`
            : geminiRes.error || 'Could not detect printed field labels automatically.'
          : null

      nextExtracted = {
        documentType: base?.documentType || 'Other',
        documentKind:
          base?.documentKind && base.documentKind !== 'other'
            ? base.documentKind
            : 'blank_form',
        isForm: true,
        documentTitle: base?.documentTitle || formTitle,
        userCategory: base?.userCategory || null,
        issuer: base?.issuer || null,
        customerName: base?.customerName || null,
        documentDate: base?.documentDate || null,
        dueDate: base?.dueDate || null,
        expiryDate: base?.expiryDate || null,
        totalAmount: base?.totalAmount ?? null,
        currency: base?.currency || '₹',
        productName: base?.productName || null,
        modelNumber: base?.modelNumber || null,
        serialNumber: base?.serialNumber || null,
        purchaseDate: base?.purchaseDate || null,
        warrantyDuration: base?.warrantyDuration || null,
        warrantyExpiry: base?.warrantyExpiry || null,
        policyNumber: base?.policyNumber || null,
        importantConditions: base?.importantConditions || null,
        contactDetails: base?.contactDetails || null,
        supportPhone: base?.supportPhone || null,
        supportEmail: base?.supportEmail || null,
        supportWebsite: base?.supportWebsite || null,
        supportingDetails: base?.supportingDetails || null,
        formAnalysis: {
          isForm: true,
          documentKind:
            base?.documentKind && base.documentKind !== 'other'
              ? base.documentKind
              : 'blank_form',
          formTitle,
          formPurpose:
            base?.formAnalysis?.formPurpose ||
            base?.summary ||
            'Blank form with printed fields to complete.',
          whoShouldFill: base?.formAnalysis?.whoShouldFill || 'Applicant / Individual',
          requiredDocuments: base?.formAnalysis?.requiredDocuments || [],
          instructions: base?.formAnalysis?.instructions || [],
          fields: fallbackFields,
          detectionMethods: methods,
          ...(doc.extractedData?.formAnalysis?.savedAnswers
            ? { savedAnswers: doc.extractedData.formAnalysis.savedAnswers }
            : {}),
          ...(formDetectionNote ? { formDetectionNote } : {}),
        },
        summary: base?.summary || `Form document "${formTitle}" with ${fallbackFields.length} detected field(s).`,
      }
    }
  }

  if (!nextExtracted) return doc

  if (userId || doc.id.startsWith('doc_')) {
    const saved = await updateDocument(
      doc.id,
      {
        extractionStatus: 'completed',
        extractedData: nextExtracted,
        extractionError: null,
      },
      userId
    ).catch(() => null)
    if (saved) return saved
  }

  return {
    ...doc,
    extractionStatus: 'completed',
    extractedData: nextExtracted,
    extractionError: null,
  }
}
