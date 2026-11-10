import type {
  DocumentCategory,
  ExtractedDocumentData,
  FormAnalysis,
  FormSavedAnswer,
} from './types.ts'

export const VALID_DOC_TYPES: DocumentCategory[] = [
  'Bill',
  'Invoice',
  'Warranty',
  'Insurance',
  'Receipt',
  'Manual',
  'Contract',
  'Other',
]

function sanitizeSavedAnswers(
  raw: unknown
): Record<string, FormSavedAnswer> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const result: Record<string, FormSavedAnswer> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k.trim() || !v || typeof v !== 'object') continue
    const rec = v as Record<string, unknown>
    result[k.trim()] = {
      value: typeof rec.value === 'string' ? rec.value : '',
      confirmed: Boolean(rec.confirmed),
      skipped: Boolean(rec.skipped),
      source: typeof rec.source === 'string' ? rec.source : null,
      updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : new Date().toISOString(),
    }
  }
  return result
}

export function mergeExtractedMetadata(
  base: ExtractedDocumentData | null | undefined,
  input: Record<string, unknown> | null | undefined
): ExtractedDocumentData {
  const current: ExtractedDocumentData = base || {
    documentType: 'Other',
    documentKind: 'other',
    isForm: false,
    documentTitle: null,
    userCategory: null,
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
    supportPhone: null,
    supportEmail: null,
    supportWebsite: null,
    supportingDetails: null,
    formAnalysis: null,
    summary: null,
  }

  if (!input || typeof input !== 'object') {
    return current
  }

  const cleanStr = (v: unknown): string | null | undefined => {
    if (v === null) return null
    if (typeof v !== 'string') return undefined
    const trimmed = v.trim()
    if (!trimmed || /^not found$/i.test(trimmed)) return null
    return trimmed
  }

  let nextAmount = current.totalAmount
  if (input.totalAmount === null || input.totalAmount === '') {
    nextAmount = null
  } else if (typeof input.totalAmount === 'number' && !Number.isNaN(input.totalAmount)) {
    nextAmount = input.totalAmount
  } else if (typeof input.totalAmount === 'string') {
    const cleanedNum = Number(input.totalAmount.replace(/[₹$,\s]/g, ''))
    nextAmount = !Number.isNaN(cleanedNum) && cleanedNum >= 0 ? cleanedNum : current.totalAmount
  }

  let nextConditions = current.importantConditions
  if (input.importantConditions === null) {
    nextConditions = null
  } else if (Array.isArray(input.importantConditions)) {
    nextConditions = input.importantConditions
      .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
      .map((x) => x.trim())
      .slice(0, 8)
    if (nextConditions.length === 0) nextConditions = null
  } else if (typeof input.importantConditions === 'string') {
    const split = input.importantConditions
      .split(/\n|;/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8)
    nextConditions = split.length > 0 ? split : null
  }

  return {
    ...current,
    documentType: VALID_DOC_TYPES.includes(input.documentType as DocumentCategory)
      ? (input.documentType as DocumentCategory)
      : current.documentType,
    documentTitle:
      input.documentTitle !== undefined ? cleanStr(input.documentTitle) ?? null : current.documentTitle ?? null,
    userCategory:
      input.userCategory !== undefined ? cleanStr(input.userCategory) ?? null : current.userCategory ?? null,
    issuer: input.issuer !== undefined ? cleanStr(input.issuer) ?? null : current.issuer,
    customerName: input.customerName !== undefined ? cleanStr(input.customerName) ?? null : current.customerName,
    documentDate: input.documentDate !== undefined ? cleanStr(input.documentDate) ?? null : current.documentDate,
    dueDate: input.dueDate !== undefined ? cleanStr(input.dueDate) ?? null : current.dueDate,
    expiryDate: input.expiryDate !== undefined ? cleanStr(input.expiryDate) ?? null : current.expiryDate,
    totalAmount: nextAmount,
    currency: input.currency !== undefined ? cleanStr(input.currency) ?? '₹' : current.currency,
    productName: input.productName !== undefined ? cleanStr(input.productName) ?? null : current.productName,
    modelNumber: input.modelNumber !== undefined ? cleanStr(input.modelNumber) ?? null : current.modelNumber,
    serialNumber: input.serialNumber !== undefined ? cleanStr(input.serialNumber) ?? null : current.serialNumber,
    purchaseDate: input.purchaseDate !== undefined ? cleanStr(input.purchaseDate) ?? null : current.purchaseDate,
    warrantyDuration:
      input.warrantyDuration !== undefined ? cleanStr(input.warrantyDuration) ?? null : current.warrantyDuration,
    warrantyExpiry:
      input.warrantyExpiry !== undefined ? cleanStr(input.warrantyExpiry) ?? null : current.warrantyExpiry,
    policyNumber: input.policyNumber !== undefined ? cleanStr(input.policyNumber) ?? null : current.policyNumber,
    importantConditions: nextConditions,
    contactDetails:
      input.contactDetails !== undefined ? cleanStr(input.contactDetails) ?? null : current.contactDetails,
    supportPhone:
      input.supportPhone !== undefined ? cleanStr(input.supportPhone) ?? null : current.supportPhone ?? null,
    supportEmail:
      input.supportEmail !== undefined ? cleanStr(input.supportEmail) ?? null : current.supportEmail ?? null,
    supportWebsite:
      input.supportWebsite !== undefined ? cleanStr(input.supportWebsite) ?? null : current.supportWebsite ?? null,
    documentKind:
      typeof input.documentKind === 'string'
        ? (input.documentKind as ExtractedDocumentData['documentKind'])
        : current.documentKind,
    isForm:
      typeof input.isForm === 'boolean'
        ? input.isForm
        : Boolean(current.isForm || current.formAnalysis?.isForm),
    supportingDetails:
      input.supportingDetails && typeof input.supportingDetails === 'object' && !Array.isArray(input.supportingDetails)
        ? (input.supportingDetails as Record<string, string>)
        : current.supportingDetails ?? null,
    formAnalysis: (() => {
      const nextForm =
        input.formAnalysis && typeof input.formAnalysis === 'object'
          ? (input.formAnalysis as FormAnalysis)
          : current.formAnalysis ?? null
      if (!nextForm) return null
      const saved =
        sanitizeSavedAnswers((input.formAnalysis as any)?.savedAnswers) ??
        sanitizeSavedAnswers(input.savedFormAnswers) ??
        nextForm.savedAnswers ??
        current.formAnalysis?.savedAnswers
      return saved ? { ...nextForm, savedAnswers: saved } : nextForm
    })(),
    summary: input.summary !== undefined ? cleanStr(input.summary) ?? null : current.summary,
  }
}
