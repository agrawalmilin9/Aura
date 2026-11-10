import type {
  DocumentCategory,
  DocumentKind,
  ExtractedDocumentData,
  FormAnalysis,
  FormDetectionMethod,
  FormFieldSpec,
  FormFieldType,
} from './types.ts'
import {
  buildFieldSpecFromLabel,
  dedupeFormFields,
  extractPdfPrintedText,
  inspectPdfAcroForm,
  renderPdfPagesToPng,
  type AcroFormFieldSummary,
  type PdfTextExtractionResult,
} from './pdf-form.ts'

const DEFAULT_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-2.5-pro',
]

const VISION_PRIORITY_MODELS = [
  'gemini-2.5-flash',
  'gemini-3-flash-preview',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
]

const VALID_DOCUMENT_KINDS: DocumentKind[] = [
  'blank_form',
  'application_form',
  'claim_form',
  'registration_form',
  'invoice',
  'bill',
  'insurance_document',
  'warranty_card',
  'supporting_document',
  'agreement',
  'other',
]

const VALID_FIELD_TYPES: FormFieldType[] = [
  'text',
  'date',
  'number',
  'select',
  'checkbox',
  'email',
  'phone',
  'textarea',
  'signature',
  'unclear',
]

const VALID_DETECTION_METHODS: FormDetectionMethod[] = [
  'acroform',
  'pdf_text',
  'gemini_pdf',
  'gemini_vision_pages',
  'manual',
]

const EXTRACTION_PROMPT = `You are AURA's precision Document & Form Analysis AI for personal life administration in India.
Analyze the provided document (PDF or image) and return a strictly valid JSON object.

RULES:
1. Extract ONLY facts explicitly visible in the document. If a field is NOT present, use null. NEVER invent or assume personal data.
2. Accurately identify "documentKind" from: "blank_form", "application_form", "claim_form", "registration_form", "invoice", "bill", "insurance_document", "warranty_card", "supporting_document", "agreement", "other".
3. CRITICAL BLANK FORM RULE: A blank form very frequently has printed field labels, empty lines, tables, checkboxes, or boxes WITHOUT interactive PDF AcroForm fields! Even if every input space is completely empty, if this document asks a person to fill out information, set "isForm": true and "documentKind": "blank_form" (or "application_form" / "claim_form" / "registration_form"). Invoices, utility bills, receipts, warranty cards, or ID/supporting proofs MUST have "isForm": false and "formAnalysis": null.
4. For supporting documents (bills, invoices, policies, warranty cards, IDs/proofs), also extract helpful factual attributes found verbatim in the document under "supportingDetails" (for example: {"Address": "...", "Consumer Number": "...", "Account Holder": "...", "IFSC Code": "..."}), WITHOUT inventing missing attributes.
5. When "isForm" is true, carefully extract EVERY visible printed field, empty space, table input, checkbox/radio option, signature box, and form instruction on EVERY page into "formAnalysis":
   - Preserve the exact "fieldName" label as printed on the form.
   - Include empty fields! Never ignore a field just because its answer box is blank.
   - Number fields sequentially starting at 1 ("fieldNumber").
   - Set "isUnreadable": true ONLY if a label or instruction is blurry/cut off/unreadable rather than guessing it.
   - Set "isSensitive": true for sensitive IDs/credentials/dates/emergency contacts (e.g. Aadhaar, PAN, Passport No, Bank Account No, IFSC, Card No, DOB, Signature).
   - Provide clear simple-English "meaning", "whatToEnter", and a clearly synthetic sample "example" (e.g. "Riya Sharma", "15/08/1995", "HDFC-POL-12345").
6. Identify "documentType" strictly as one of: "Bill", "Invoice", "Warranty", "Insurance", "Receipt", "Manual", "Contract", "Other".
7. Total amount must be a number without currency symbols, or null if not applicable.
8. Return ONLY valid JSON with no markdown outside it.

Expected JSON schema:
{
  "documentType": "Bill" | "Invoice" | "Warranty" | "Insurance" | "Receipt" | "Manual" | "Contract" | "Other",
  "documentKind": "blank_form" | "application_form" | "claim_form" | "registration_form" | "invoice" | "bill" | "insurance_document" | "warranty_card" | "supporting_document" | "agreement" | "other",
  "isForm": boolean,
  "documentTitle": string | null,
  "issuer": string | null,
  "customerName": string | null,
  "documentDate": string | null,
  "dueDate": string | null,
  "expiryDate": string | null,
  "totalAmount": number | null,
  "currency": string | null,
  "productName": string | null,
  "modelNumber": string | null,
  "serialNumber": string | null,
  "purchaseDate": string | null,
  "warrantyDuration": string | null,
  "warrantyExpiry": string | null,
  "policyNumber": string | null,
  "importantConditions": string[] | null,
  "contactDetails": string | null,
  "supportPhone": string | null,
  "supportEmail": string | null,
  "supportWebsite": string | null,
  "supportingDetails": { [key: string]: string } | null,
  "formAnalysis": {
    "isForm": true,
    "documentKind": "blank_form" | "application_form" | "claim_form" | "registration_form",
    "formTitle": string | null,
    "formPurpose": string | null,
    "whoShouldFill": string | null,
    "requiredDocuments": string[],
    "instructions": string[],
    "fields": [
      {
        "fieldNumber": number,
        "fieldName": string,
        "section": string | null,
        "fieldType": "text" | "date" | "number" | "select" | "checkbox" | "email" | "phone" | "textarea" | "signature" | "unclear",
        "options": string[],
        "required": boolean,
        "meaning": string,
        "whatToEnter": string,
        "example": string,
        "isSensitive": boolean,
        "isUnreadable": boolean
      }
    ]
  } | null,
  "summary": string | null
}`

const PAGE_VISION_FORM_PROMPT = `You are inspecting a rendered page image from a PDF document using visual OCR + layout understanding.
Your job is to determine accurately whether this page belongs to a blank/printed form, application, claim, or registration document, and if so extract EVERY visible field on this page — even if all spaces/boxes/lines are completely empty and there are no interactive digital PDF fields.

RULES:
1. Extract ONLY labels, sections, checkboxes, table columns/rows, signatures, required document checklists, and instructions visibly printed on this page.
2. NEVER invent labels. If a label is too blurry/cropped/illegible to read, include it with "fieldType": "unclear" and "isUnreadable": true.
3. For checkbox or radio choices grouped under a label (e.g. Gender: Male / Female / Other), set "fieldType": "select" or "checkbox" and include exact "options": ["Male", "Female", "Other"].
4. Do NOT mistake regular bills/invoices/receipts with charges due for blank forms. If this is clearly not a form (e.g. a paid tax invoice or utility bill), return {"isForm": false, "documentKind": "other", "fields": []}.
5. Return ONLY valid JSON matching:
{
  "isForm": boolean,
  "documentKind": "blank_form" | "application_form" | "claim_form" | "registration_form" | "other",
  "formTitle": string | null,
  "formPurpose": string | null,
  "whoShouldFill": string | null,
  "requiredDocuments": string[],
  "instructions": string[],
  "fields": [
    {
      "fieldNumber": number,
      "fieldName": string,
      "section": string | null,
      "fieldType": "text" | "date" | "number" | "select" | "checkbox" | "email" | "phone" | "textarea" | "signature" | "unclear",
      "options": string[],
      "required": boolean,
      "meaning": string,
      "whatToEnter": string,
      "example": string,
      "isSensitive": boolean,
      "isUnreadable": boolean
    }
  ],
  "summary": string | null
}`

export interface ExtractionResult {
  success: boolean
  data: ExtractedDocumentData | null
  error?: string
}

function sanitizeFieldArray(rawFields: any[]): FormFieldSpec[] {
  return rawFields
    .filter((f: any) => f && typeof f === 'object' && typeof f.fieldName === 'string' && f.fieldName.trim())
    .slice(0, 80)
    .map((f: any, idx: number): FormFieldSpec => {
      const fType: FormFieldType = VALID_FIELD_TYPES.includes(f.fieldType) ? f.fieldType : 'text'
      const cleanName = f.fieldName.trim()
      return {
        fieldNumber: typeof f.fieldNumber === 'number' && f.fieldNumber > 0 ? Math.floor(f.fieldNumber) : idx + 1,
        fieldName: cleanName,
        section: typeof f.section === 'string' ? f.section.trim() || null : null,
        fieldType: fType,
        options: Array.isArray(f.options)
          ? f.options.filter((o: any) => typeof o === 'string' && o.trim()).map((o: string) => o.trim()).slice(0, 20)
          : undefined,
        required: f.required !== false,
        meaning: typeof f.meaning === 'string' && f.meaning.trim() ? f.meaning.trim() : `Enter ${cleanName}.`,
        whatToEnter:
          typeof f.whatToEnter === 'string' && f.whatToEnter.trim()
            ? f.whatToEnter.trim()
            : 'Provide accurate value as printed on your supporting record.',
        example: typeof f.example === 'string' && f.example.trim() ? f.example.trim() : 'N/A',
        isSensitive: Boolean(f.isSensitive),
        isUnreadable: Boolean(f.isUnreadable || fType === 'unclear'),
      }
    })
}

function cleanJsonString(rawText: string): string {
  let cleaned = rawText.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  }
  return cleaned
}

/**
 * Parses and sanitizes raw JSON returned by Gemini.
 */
export function sanitizeExtractedJson(rawText: string): ExtractedDocumentData {
  const parsed = JSON.parse(cleanJsonString(rawText))

  const allowedTypes: DocumentCategory[] = [
    'Bill',
    'Invoice',
    'Warranty',
    'Insurance',
    'Receipt',
    'Manual',
    'Contract',
    'Other',
  ]

  const documentType: DocumentCategory = allowedTypes.includes(parsed.documentType)
    ? parsed.documentType
    : 'Other'

  const documentKind: DocumentKind = VALID_DOCUMENT_KINDS.includes(parsed.documentKind)
    ? parsed.documentKind
    : documentType === 'Bill'
    ? 'bill'
    : documentType === 'Invoice'
    ? 'invoice'
    : documentType === 'Insurance'
    ? 'insurance_document'
    : documentType === 'Warranty'
    ? 'warranty_card'
    : documentType === 'Contract'
    ? 'agreement'
    : 'other'

  const supportingDetails: Record<string, string> | null =
    parsed.supportingDetails && typeof parsed.supportingDetails === 'object' && !Array.isArray(parsed.supportingDetails)
      ? Object.fromEntries(
          Object.entries(parsed.supportingDetails)
            .filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim())
            .slice(0, 20)
            .map(([k, v]) => [k.trim(), (v as string).trim()])
        )
      : null

  let formAnalysis: FormAnalysis | null = null
  const isForm = Boolean(parsed.isForm || parsed.formAnalysis?.isForm)
  if (isForm && parsed.formAnalysis && typeof parsed.formAnalysis === 'object') {
    const rawFields = Array.isArray(parsed.formAnalysis.fields) ? parsed.formAnalysis.fields : []
    const fields = sanitizeFieldArray(rawFields)
    const detectionMethods = Array.isArray(parsed.formAnalysis.detectionMethods)
      ? parsed.formAnalysis.detectionMethods.filter((m: any) => VALID_DETECTION_METHODS.includes(m))
      : undefined

    formAnalysis = {
      isForm: true,
      documentKind,
      formTitle:
        typeof parsed.formAnalysis.formTitle === 'string'
          ? parsed.formAnalysis.formTitle.trim() || null
          : typeof parsed.documentTitle === 'string'
          ? parsed.documentTitle.trim() || null
          : null,
      formPurpose:
        typeof parsed.formAnalysis.formPurpose === 'string' ? parsed.formAnalysis.formPurpose.trim() || null : null,
      whoShouldFill:
        typeof parsed.formAnalysis.whoShouldFill === 'string' ? parsed.formAnalysis.whoShouldFill.trim() || null : null,
      requiredDocuments: Array.isArray(parsed.formAnalysis.requiredDocuments)
        ? parsed.formAnalysis.requiredDocuments
            .filter((d: any) => typeof d === 'string' && d.trim())
            .map((d: string) => d.trim())
            .slice(0, 15)
        : [],
      instructions: Array.isArray(parsed.formAnalysis.instructions)
        ? parsed.formAnalysis.instructions
            .filter((i: any) => typeof i === 'string' && i.trim())
            .map((i: string) => i.trim())
            .slice(0, 12)
        : [],
      fields,
      ...(detectionMethods && detectionMethods.length > 0 ? { detectionMethods } : {}),
      ...(typeof parsed.formAnalysis.formDetectionNote === 'string' && parsed.formAnalysis.formDetectionNote.trim()
        ? { formDetectionNote: parsed.formAnalysis.formDetectionNote.trim() }
        : {}),
    }
  }

  return {
    documentType,
    documentKind,
    isForm: Boolean(formAnalysis),
    documentTitle: typeof parsed.documentTitle === 'string' ? parsed.documentTitle.trim() || null : null,
    issuer: typeof parsed.issuer === 'string' ? parsed.issuer.trim() || null : null,
    customerName: typeof parsed.customerName === 'string' ? parsed.customerName.trim() || null : null,
    documentDate: typeof parsed.documentDate === 'string' ? parsed.documentDate.trim() || null : null,
    dueDate: typeof parsed.dueDate === 'string' ? parsed.dueDate.trim() || null : null,
    expiryDate: typeof parsed.expiryDate === 'string' ? parsed.expiryDate.trim() || null : null,
    totalAmount:
      typeof parsed.totalAmount === 'number' && !isNaN(parsed.totalAmount)
        ? parsed.totalAmount
        : null,
    currency: typeof parsed.currency === 'string' ? parsed.currency.trim() || null : null,
    productName: typeof parsed.productName === 'string' ? parsed.productName.trim() || null : null,
    modelNumber: typeof parsed.modelNumber === 'string' ? parsed.modelNumber.trim() || null : null,
    serialNumber: typeof parsed.serialNumber === 'string' ? parsed.serialNumber.trim() || null : null,
    purchaseDate: typeof parsed.purchaseDate === 'string' ? parsed.purchaseDate.trim() || null : null,
    warrantyDuration:
      typeof parsed.warrantyDuration === 'string' ? parsed.warrantyDuration.trim() || null : null,
    warrantyExpiry:
      typeof parsed.warrantyExpiry === 'string' ? parsed.warrantyExpiry.trim() || null : null,
    policyNumber: typeof parsed.policyNumber === 'string' ? parsed.policyNumber.trim() || null : null,
    importantConditions: Array.isArray(parsed.importantConditions)
      ? parsed.importantConditions
          .filter((item: any) => typeof item === 'string' && item.trim())
          .slice(0, 8)
      : null,
    contactDetails:
      typeof parsed.contactDetails === 'string' ? parsed.contactDetails.trim() || null : null,
    supportPhone:
      typeof parsed.supportPhone === 'string' ? parsed.supportPhone.trim() || null : null,
    supportEmail:
      typeof parsed.supportEmail === 'string' ? parsed.supportEmail.trim() || null : null,
    supportWebsite:
      typeof parsed.supportWebsite === 'string' ? parsed.supportWebsite.trim() || null : null,
    supportingDetails: supportingDetails && Object.keys(supportingDetails).length > 0 ? supportingDetails : null,
    formAnalysis,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() || null : null,
  }
}

async function callGeminiWithParts(params: {
  apiKey: string
  modelsToTry: string[]
  parts: any[]
}): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }> {
  let lastError = 'No models available'

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: params.parts,
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
    },
  }

  for (const model of params.modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${params.apiKey}`
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      const raw = await response.text()

      if (!response.ok) {
        let errDesc = `HTTP ${response.status}`
        try {
          const parsed = JSON.parse(raw)
          errDesc = parsed.error?.message || errDesc
        } catch {}
        lastError = `Model ${model}: ${errDesc}`

        if (
          response.status === 404 ||
          response.status === 429 ||
          response.status === 503 ||
          errDesc.includes('no longer available') ||
          errDesc.includes('high demand')
        ) {
          continue
        }

        return { ok: false, error: lastError }
      }

      const data = JSON.parse(raw)
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
      if (!text) {
        lastError = `Model ${model}: Empty candidate text`
        continue
      }

      return { ok: true, text, model }
    } catch (err: any) {
      lastError = err?.message || String(err)
    }
  }

  return { ok: false, error: lastError }
}

/**
 * Checks whether metadata or printed PDF text strongly indicates a blank/fillable form document.
 */
export function hasFormSignals(params: {
  extracted?: ExtractedDocumentData | null
  printedText?: PdfTextExtractionResult | null
  hasAcroFields?: boolean
  filenameOrTitle?: string
}): boolean {
  if (params.hasAcroFields) return true
  if (params.extracted?.isForm) return true
  if (
    params.extracted?.documentKind &&
    ['blank_form', 'application_form', 'claim_form', 'registration_form'].includes(
      params.extracted.documentKind
    )
  ) {
    return true
  }

  const corpus = [
    params.filenameOrTitle,
    params.extracted?.documentTitle,
    params.extracted?.summary,
    params.printedText?.combinedText,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  const nonFormInvoiceSignals =
    corpus.includes('tax invoice') ||
    corpus.includes('gstin') ||
    corpus.includes('amount due') ||
    corpus.includes('total amount') ||
    corpus.includes('receipt no')
  if (nonFormInvoiceSignals && !corpus.includes('blank') && !corpus.includes('please complete')) {
    return false
  }

  const formSignals = [
    'blank form',
    'personal details form',
    'application form',
    'claim form',
    'registration form',
    'enrollment form',
    'kyc form',
    'please complete this form',
    'block letters',
    'applicant signature',
    "applicant's signature",
    'i hereby declare',
  ]
  if (formSignals.some((s) => corpus.includes(s))) return true

  if ((params.printedText?.candidateFields?.length || 0) >= 4 && corpus.includes('form')) {
    return true
  }
  return false
}

async function runVisualPageByPageFormExtraction(params: {
  apiKey: string
  modelsToTry: string[]
  buffer: Buffer
  printedText: PdfTextExtractionResult | null
}): Promise<{
  isForm: boolean
  documentKind: DocumentKind
  formTitle: string | null
  formPurpose: string | null
  whoShouldFill: string | null
  requiredDocuments: string[]
  instructions: string[]
  fields: FormFieldSpec[]
  summary: string | null
  renderedPageCount: number
  errors: string[]
}> {
  const renderedPages = await renderPdfPagesToPng(params.buffer, 5, 1.75)
  const collectedFields: FormFieldSpec[] = []
  const instructions: string[] = []
  const requiredDocuments: string[] = []
  const errors: string[] = []

  let isForm = false
  let documentKind: DocumentKind = 'other'
  let formTitle: string | null = null
  let formPurpose: string | null = null
  let whoShouldFill: string | null = null
  let summary: string | null = null

  for (const pageImg of renderedPages) {
    const pageTextHint = params.printedText?.pages.find((p) => p.pageNumber === pageImg.pageNumber)?.fullText || ''
    const prompt = `${PAGE_VISION_FORM_PROMPT}\n\nPage ${pageImg.pageNumber} of ${params.printedText?.pageCount || renderedPages.length}.${
      pageTextHint.trim()
        ? `\n\nExtracted printed text on Page ${pageImg.pageNumber} (use to preserve exact spelling):\n${pageTextHint.slice(0, 4500)}`
        : '\n\nNo selectable text was found on this page — use visual OCR directly on the rendered PNG image.'
    }`

    const callRes = await callGeminiWithParts({
      apiKey: params.apiKey,
      modelsToTry: params.modelsToTry,
      parts: [
        {
          inlineData: {
            mimeType: 'image/png',
            data: pageImg.pngBuffer.toString('base64'),
          },
        },
        { text: prompt },
      ],
    })

    if (!callRes.ok) {
      errors.push(`Page ${pageImg.pageNumber}: ${callRes.error}`)
      continue
    }

    try {
      const parsed = JSON.parse(cleanJsonString(callRes.text))
      const rawFields = Array.isArray(parsed.fields) ? parsed.fields : []
      const pageFields = sanitizeFieldArray(rawFields)
      if (parsed.isForm || pageFields.length > 0) {
        isForm = true
        if (VALID_DOCUMENT_KINDS.includes(parsed.documentKind) && parsed.documentKind !== 'other') {
          documentKind = parsed.documentKind
        } else if (documentKind === 'other') {
          documentKind = 'blank_form'
        }
        if (!formTitle && typeof parsed.formTitle === 'string' && parsed.formTitle.trim()) {
          formTitle = parsed.formTitle.trim()
        }
        if (!formPurpose && typeof parsed.formPurpose === 'string' && parsed.formPurpose.trim()) {
          formPurpose = parsed.formPurpose.trim()
        }
        if (!whoShouldFill && typeof parsed.whoShouldFill === 'string' && parsed.whoShouldFill.trim()) {
          whoShouldFill = parsed.whoShouldFill.trim()
        }
        if (!summary && typeof parsed.summary === 'string' && parsed.summary.trim()) {
          summary = parsed.summary.trim()
        }
        if (Array.isArray(parsed.instructions)) {
          for (const ins of parsed.instructions) {
            if (typeof ins === 'string' && ins.trim() && !instructions.includes(ins.trim())) {
              instructions.push(ins.trim())
            }
          }
        }
        if (Array.isArray(parsed.requiredDocuments)) {
          for (const reqDoc of parsed.requiredDocuments) {
            if (typeof reqDoc === 'string' && reqDoc.trim() && !requiredDocuments.includes(reqDoc.trim())) {
              requiredDocuments.push(reqDoc.trim())
            }
          }
        }
        collectedFields.push(...pageFields)
      }
    } catch (parseErr: any) {
      errors.push(`Page ${pageImg.pageNumber} parse error: ${parseErr?.message || 'Invalid JSON'}`)
    }
  }

  return {
    isForm,
    documentKind,
    formTitle,
    formPurpose,
    whoShouldFill,
    requiredDocuments: requiredDocuments.slice(0, 15),
    instructions: instructions.slice(0, 12),
    fields: dedupeFormFields(collectedFields),
    summary,
    renderedPageCount: renderedPages.length,
    errors,
  }
}

/**
 * Converts interactive AcroForm fields into FormFieldSpec objects so AcroForm fields
 * are never dropped even if Gemini missed some.
 */
function acroFieldsToSpecs(acroFields: AcroFormFieldSummary[]): FormFieldSpec[] {
  return acroFields.map((f, idx) =>
    buildFieldSpecFromLabel({
      fieldNumber: idx + 1,
      fieldName: f.name,
      fieldType: f.type,
      options: f.options,
    })
  )
}

/**
 * Extracts structured data and form analysis from a document buffer using multi-method inspection:
 * 1) PDF AcroForm inspection + PDF printed text extraction
 * 2) Gemini multimodal document extraction
 * 3) Page-by-page visual PNG + OCR fallback if a blank/scanned form yields 0 fields
 * 4) Field combining & deduplication
 */
export async function extractDocumentWithGemini(
  buffer: Buffer,
  mimeType: string,
  categoryHint?: string
): Promise<ExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return {
      success: false,
      data: null,
      error: 'GEMINI_API_KEY is not configured on the server.',
    }
  }

  const modelEnv = process.env.GEMINI_MODEL
  const modelsToTry = modelEnv ? [modelEnv, ...DEFAULT_MODELS] : DEFAULT_MODELS
  const visionModels = modelEnv ? [modelEnv, ...VISION_PRIORITY_MODELS] : VISION_PRIORITY_MODELS

  let acroResult = { isPdf: false, hasFillableFields: false, fields: [] as AcroFormFieldSummary[] }
  let printedTextResult: PdfTextExtractionResult | null = null
  const detectionMethods: FormDetectionMethod[] = []

  if (mimeType === 'application/pdf') {
    const [acro, printed] = await Promise.all([
      inspectPdfAcroForm(buffer),
      extractPdfPrintedText(buffer),
    ])
    acroResult = acro
    printedTextResult = printed
    if (acro.hasFillableFields) detectionMethods.push('acroform')
    if (printed.totalChars > 0) detectionMethods.push('pdf_text')
  }

  const hintBlocks: string[] = []
  if (categoryHint) {
    hintBlocks.push(
      `Note: The user indicated this may belong to category "${categoryHint}", but only confirm details explicitly visible in the document.`
    )
  }
  if (acroResult.hasFillableFields && acroResult.fields.length > 0) {
    hintBlocks.push(
      `Interactive PDF AcroForm fields detected in this PDF: ${acroResult.fields
        .slice(0, 50)
        .map((f) => `${f.name} (${f.type})`)
        .join(', ')}. Include these exact interactive fields in formAnalysis.fields.`
    )
  }
  if (printedTextResult?.isPdf && printedTextResult.totalChars > 0) {
    hintBlocks.push(
      `Printed PDF text extracted cleanly across ${printedTextResult.pageCount} page(s) (AcroForm interactive widgets count: ${acroResult.fields.length}). Use these verbatim printed labels & instructions if this is a blank or printed form:\n${printedTextResult.combinedText.slice(0, 10000)}`
    )
  } else if (printedTextResult?.isLikelyScanned) {
    hintBlocks.push(
      `This PDF appears scanned/image-based (${printedTextResult.pageCount} page(s), little selectable text). Perform careful visual/OCR reading on every page.`
    )
  }

  const promptText = `${EXTRACTION_PROMPT}${hintBlocks.length > 0 ? `\n\n${hintBlocks.join('\n\n')}` : ''}`

  const primaryCall = await callGeminiWithParts({
    apiKey,
    modelsToTry,
    parts: [
      {
        inlineData: {
          mimeType,
          data: buffer.toString('base64'),
        },
      },
      { text: promptText },
    ],
  })

  let extracted: ExtractedDocumentData | null = null
  let primaryError: string | undefined

  if (primaryCall.ok) {
    try {
      extracted = sanitizeExtractedJson(primaryCall.text)
      if (extracted.isForm) detectionMethods.push('gemini_pdf')
    } catch (parseErr: any) {
      primaryError = `Invalid JSON returned by Gemini: ${parseErr?.message || parseErr}`
    }
  } else {
    primaryError = primaryCall.error
  }

  // Decide whether we need page-by-page visual/OCR retry (ONLY for PDFs!)
  const existingFieldsCount = extracted?.formAnalysis?.fields?.length || 0
  const strongFormEvidence = hasFormSignals({
    extracted,
    printedText: printedTextResult,
    hasAcroFields: acroResult.hasFillableFields,
    filenameOrTitle: categoryHint,
  })

  const needsVisualPageRetry =
    mimeType === 'application/pdf' &&
    ((!extracted && true) ||
      (existingFieldsCount === 0 && (strongFormEvidence || Boolean(printedTextResult?.isLikelyScanned))))

  if (needsVisualPageRetry) {
    const visual = await runVisualPageByPageFormExtraction({
      apiKey,
      modelsToTry: visionModels,
      buffer,
      printedText: printedTextResult,
    })

    if (visual.renderedPageCount > 0 && (visual.isForm || visual.fields.length > 0)) {
      detectionMethods.push('gemini_vision_pages')
      const mergedFields = dedupeFormFields([
        ...(extracted?.formAnalysis?.fields || []),
        ...visual.fields,
        ...acroFieldsToSpecs(acroResult.fields),
        ...(visual.fields.length === 0 && printedTextResult?.candidateFields ? printedTextResult.candidateFields : []),
      ])

      const formTitle =
        extracted?.formAnalysis?.formTitle ||
        visual.formTitle ||
        extracted?.documentTitle ||
        null

      const nextDocKind: DocumentKind =
        visual.documentKind !== 'other'
          ? visual.documentKind
          : extracted?.documentKind && extracted.documentKind !== 'other'
            ? extracted.documentKind
            : 'blank_form'

      const recoveredAnalysis: FormAnalysis = {
        isForm: true,
        documentKind: nextDocKind,
        formTitle,
        formPurpose: extracted?.formAnalysis?.formPurpose || visual.formPurpose,
        whoShouldFill: extracted?.formAnalysis?.whoShouldFill || visual.whoShouldFill,
        requiredDocuments:
          extracted?.formAnalysis?.requiredDocuments?.length
            ? extracted.formAnalysis.requiredDocuments
            : visual.requiredDocuments,
        instructions:
          extracted?.formAnalysis?.instructions?.length
            ? extracted.formAnalysis.instructions
            : visual.instructions,
        fields: mergedFields,
        detectionMethods: Array.from(new Set(detectionMethods)),
      }

      if (!extracted) {
        extracted = {
          documentType: 'Other',
          documentKind: nextDocKind,
          isForm: true,
          documentTitle: formTitle,
          issuer: null,
          customerName: null,
          documentDate: null,
          dueDate: null,
          expiryDate: null,
          totalAmount: null,
          currency: '₹',
          productName: null,
          modelNumber: null,
          serialNumber: null,
          purchaseDate: null,
          warrantyDuration: null,
          warrantyExpiry: null,
          policyNumber: null,
          importantConditions: null,
          contactDetails: null,
          formAnalysis: recoveredAnalysis,
          summary: visual.summary || 'Blank/printed form analyzed from rendered PDF pages.',
        }
      } else {
        extracted = {
          ...extracted,
          documentKind: nextDocKind,
          isForm: true,
          documentTitle: extracted.documentTitle || formTitle,
          formAnalysis: recoveredAnalysis,
          summary: extracted.summary || visual.summary,
        }
      }
    } else if (
      (strongFormEvidence || acroResult.hasFillableFields) &&
      (acroResult.fields.length > 0 || (printedTextResult?.candidateFields.length || 0) > 0)
    ) {
      // Combine AcroForm + printed text labels if visual retry failed (e.g., transient error) yet printed text/AcroForm succeeded
      const fallbackFields = dedupeFormFields([
        ...(extracted?.formAnalysis?.fields || []),
        ...acroFieldsToSpecs(acroResult.fields),
        ...(printedTextResult?.candidateFields || []),
      ])
      if (fallbackFields.length > 0) {
        const nextKind: DocumentKind =
          extracted?.documentKind && extracted.documentKind !== 'other' ? extracted.documentKind : 'blank_form'
        const note = visual.errors.length > 0
          ? `Visual retry encountered an error (${visual.errors[0]}); extracted fields directly from PDF layout/AcroForm text.`
          : null

        extracted = {
          ...(extracted || {
            documentType: 'Other',
            documentKind: nextKind,
            isForm: true,
            documentTitle: null,
            issuer: null,
            customerName: null,
            documentDate: null,
            dueDate: null,
            expiryDate: null,
            totalAmount: null,
            currency: '₹',
            productName: null,
            modelNumber: null,
            serialNumber: null,
            purchaseDate: null,
            warrantyDuration: null,
            warrantyExpiry: null,
            policyNumber: null,
            importantConditions: null,
            contactDetails: null,
            summary: 'Blank/printed form extracted from PDF structure.',
          }),
          documentKind: nextKind,
          isForm: true,
          formAnalysis: {
            isForm: true,
            documentKind: nextKind,
            formTitle: extracted?.formAnalysis?.formTitle || extracted?.documentTitle || null,
            formPurpose: extracted?.formAnalysis?.formPurpose || extracted?.summary || null,
            whoShouldFill: extracted?.formAnalysis?.whoShouldFill || null,
            requiredDocuments: extracted?.formAnalysis?.requiredDocuments || [],
            instructions: extracted?.formAnalysis?.instructions || [],
            fields: fallbackFields,
            detectionMethods: Array.from(new Set(detectionMethods)),
            ...(note ? { formDetectionNote: note } : {}),
          },
        }
      }
    } else if (strongFormEvidence && extracted) {
      // Honest technical explanation when a blank/scanned form genuinely yields 0 readable fields
      const techReason = printedTextResult?.isLikelyScanned
        ? `Rendered ${visual.renderedPageCount} scanned/image PDF page(s), but labels or input spaces could not be read reliably${visual.errors.length ? ` (${visual.errors[0]})` : ''}. Please upload a clearer scan or photo.`
        : `Analyzed PDF structure and rendered ${visual.renderedPageCount} page(s), but could not reliably detect readable field labels${visual.errors.length ? ` (${visual.errors[0]})` : ''}. Please upload a clearer PDF or photo.`

      const safeKind: DocumentKind =
        extracted.documentKind && extracted.documentKind !== 'other'
          ? extracted.documentKind
          : 'blank_form'

      extracted = {
        ...extracted,
        documentKind: safeKind,
        isForm: true,
        formAnalysis: {
          isForm: true,
          documentKind: safeKind,
          formTitle: extracted.formAnalysis?.formTitle || extracted.documentTitle || null,
          formPurpose: extracted.formAnalysis?.formPurpose || extracted.summary || null,
          whoShouldFill: extracted.formAnalysis?.whoShouldFill || null,
          requiredDocuments: extracted.formAnalysis?.requiredDocuments || [],
          instructions: extracted.formAnalysis?.instructions || [],
          fields: [],
          detectionMethods: Array.from(new Set(detectionMethods)),
          formDetectionNote: techReason,
        },
      }
    }
  } else if (extracted?.isForm && extracted.formAnalysis) {
    // Merge any AcroForm fields into Gemini's extracted formAnalysis and deduplicate
    const combined = dedupeFormFields([
      ...extracted.formAnalysis.fields,
      ...acroFieldsToSpecs(acroResult.fields),
    ])
    extracted = {
      ...extracted,
      formAnalysis: {
        ...extracted.formAnalysis,
        fields: combined,
        detectionMethods: Array.from(new Set(detectionMethods)),
      },
    }
  }

  if (!extracted) {
    return {
      success: false,
      data: null,
      error: `Gemini extraction failed: ${primaryError || 'Unable to read document'}`,
    }
  }

  return {
    success: true,
    data: extracted,
  }
}
