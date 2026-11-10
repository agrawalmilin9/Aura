import type { DocumentSourceReference } from './retrieval.ts'
import type {
  DocumentKind,
  FormAnalysis,
  FormFieldSpec,
  FormFieldType,
  StoredDocument,
} from './types.ts'
import type { StoredProduct } from '../products/types.ts'
import type { StoredContact } from '../contacts/types.ts'
import type { StoredMemory } from '../memory/types.ts'

export type FieldPrefillStatus =
  | 'available'
  | 'needs_confirmation'
  | 'needs_input'
  | 'optional'
  | 'unclear'

export interface UserProfileForForm {
  name?: string | null
  email?: string | null
  phone?: string | null
}

export interface FieldGuidanceItem {
  fieldNumber: number
  fieldName: string
  section: string | null
  fieldType: FormFieldType
  options?: string[]
  required: boolean
  meaning: string
  whatToEnter: string
  example: string
  isSensitive: boolean
  isUnreadable: boolean
  status: FieldPrefillStatus
  prefilledValue: string | null
  savedValue: string | null
  confirmed: boolean
  skipped: boolean
  source: string | null
  sourceDocumentId: string | null
  sourceNote: string | null
  whereToFind: string
  needsUserConfirmation: boolean
}

export interface SupportingDocChecklistItem {
  name: string
  foundInLifeFile: boolean
  matchingDocuments: Array<{
    id: string
    title: string
    originalFilename: string
  }>
}

export interface FormGuideSummary {
  totalFields: number
  mandatoryCount: number
  readyCount: number
  needsConfirmationCount: number
  missingMandatoryCount: number
  unclearCount: number
}

export interface FormGuideState {
  documentId: string
  originalFilename: string
  isForm: boolean
  documentKind: DocumentKind
  formTitle: string
  formPurpose: string
  whoShouldFill: string
  instructions: string[]
  requiredDocuments: SupportingDocChecklistItem[]
  fields: FieldGuidanceItem[]
  summary: FormGuideSummary
  formDetectionNote?: string | null
}

export interface FormIntelligenceResult {
  isFormQuery: boolean
  asksAllFields: boolean
  requestedFieldNumber: number | null
  targetFormDoc: StoredDocument | null
  formState: FormGuideState | null
  groundedFormContext: string
  formSources: DocumentSourceReference[]
}

const SENSITIVE_FIELD_PATTERNS = [
  'aadhaar',
  'aadhar',
  'pan ',
  'pan no',
  'pan number',
  'permanent account',
  'passport',
  'bank account',
  'account number',
  'account no',
  'a/c no',
  'ifsc',
  'signature',
  'sign here',
  'date of birth',
  'dob',
  'birth date',
  'nominee',
  'annual income',
  'income',
  'salary',
  'cvv',
  'driving licen',
  'voter id',
  'tax id',
  'gstin',
]

const NON_SELF_PERSON_KEYWORDS = [
  'nominee',
  'beneficiary',
  'patient',
  'spouse',
  'father',
  'mother',
  'husband',
  'wife',
  'guardian',
  'witness',
  'dealer',
  'doctor',
  'hospital',
  'employer',
  'company name',
  'insurer',
]

const FIELD_STOP_WORDS = new Set([
  'the',
  'of',
  'and',
  'or',
  'for',
  'to',
  'in',
  'on',
  'with',
  'your',
  'please',
  'enter',
  'fill',
  'if',
  'any',
  'applicable',
  'number',
  'no',
  'num',
  'details',
  'detail',
])

const HINGLISH_FORM_HINTS: Record<string, string> = {
  'फॉर्म': 'form',
  'दस्तावेज़': 'documents',
  'दस्तावेज': 'documents',
  'कागज': 'documents',
  'भरना': 'fill',
  'भरें': 'fill',
  'समझाओ': 'explain',
  'बताओ': 'tell explain',
  'पता': 'address',
  'नंबर': 'number',
  'पॉलिसी': 'policy',
  'बीमा': 'insurance',
  'बैंक': 'bank',
  'बिजली': 'electricity',
  'वारंटी': 'warranty',
  'क्लेम': 'claim',
  'खाली': 'empty',
}

function normalizeText(value: string): string {
  let out = value.toLowerCase().trim()
  for (const [k, v] of Object.entries(HINGLISH_FORM_HINTS)) {
    if (out.includes(k)) out = `${out} ${v}`
  }
  return out.replace(/[^a-z0-9\s/.-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/[\s/._-]+/)
    .filter((t) => t.length >= 2 && !FIELD_STOP_WORDS.has(t))
}

function isSensitiveFieldName(field: FormFieldSpec): boolean {
  if (field.isSensitive) return true
  const norm = ` ${normalizeText(field.fieldName)} `
  return SENSITIVE_FIELD_PATTERNS.some((p) => norm.includes(p.trim()))
}

function isNonSelfPersonField(fieldName: string): boolean {
  const norm = normalizeText(fieldName)
  return NON_SELF_PERSON_KEYWORDS.some((kw) => norm.includes(kw))
}

function makeSourceRef(doc: StoredDocument, relevantField?: string): DocumentSourceReference {
  return {
    documentId: doc.id,
    originalFilename: doc.originalFilename,
    documentType: doc.extractedData?.documentType || 'Other',
    relevantField,
    fileUrl: `/api/documents/${doc.id}/file`,
  }
}

function getDocTitle(doc: StoredDocument): string {
  return (
    doc.extractedData?.documentTitle ||
    doc.extractedData?.formAnalysis?.formTitle ||
    doc.extractedData?.productName ||
    doc.extractedData?.issuer ||
    doc.originalFilename
  )
}

interface CandidateMatch {
  value: string
  sourceLabel: string
  sourceDocumentId: string | null
  confidence: 'exact' | 'inferred'
  sourceNote: string
}

const KEY_SYNONYM_GROUPS: Array<{
  fieldKeywords: string[]
  detailKeys: string[]
  whereHint: string
}> = [
  {
    fieldKeywords: ['full name', 'applicant name', 'claimant name', 'policyholder', 'subscriber name', 'customer name', 'name of applicant', 'name'],
    detailKeys: ['applicantname', 'customername', 'fullname', 'holdername', 'insuredname', 'name'],
    whereHint: 'Your Aadhaar/PAN card, existing bills, policy certificate, or Account Profile.',
  },
  {
    fieldKeywords: ['address', 'residential address', 'correspondence address', 'installation address', 'premise address', 'street', 'pin code', 'pincode', 'postal code', 'city', 'state'],
    detailKeys: ['address', 'residentialaddress', 'installationaddress', 'serviceaddress', 'permanentaddress', 'city', 'state', 'pincode', 'postalcode'],
    whereHint: 'Your utility bills (electricity/broadband), Aadhaar card, or bank statement.',
  },
  {
    fieldKeywords: ['mobile', 'phone', 'contact number', 'telephone'],
    detailKeys: ['phone', 'mobile', 'mobilenumber', 'contactnumber', 'telephone', 'supportphone'],
    whereHint: 'Your Account Profile or registered utility/insurance records.',
  },
  {
    fieldKeywords: ['email', 'e-mail', 'mail id'],
    detailKeys: ['email', 'emailaddress', 'supportemail'],
    whereHint: 'Your Account Profile or registered invoice/policy records.',
  },
  {
    fieldKeywords: ['policy number', 'policy no', 'certificate number', 'membership no'],
    detailKeys: ['policynumber', 'policyno', 'certificateno', 'insurancenumber'],
    whereHint: 'Top section of your Insurance Policy Schedule or Renewal Notice.',
  },
  {
    fieldKeywords: ['insurer', 'insurance company', 'company name'],
    detailKeys: ['insurer', 'issuer', 'companyname'],
    whereHint: 'Header of your Insurance Policy or claim booklet.',
  },
  {
    fieldKeywords: ['model', 'model number', 'model no'],
    detailKeys: ['modelnumber', 'modelno', 'model'],
    whereHint: 'Your Product Invoice, Warranty Card, or appliance rating sticker.',
  },
  {
    fieldKeywords: ['serial', 'serial number', 'serial no', 'imei'],
    detailKeys: ['serialnumber', 'serialno', 'imei'],
    whereHint: 'Your Product Invoice, Warranty Card, or device back panel.',
  },
  {
    fieldKeywords: ['purchase date', 'date of purchase', 'invoice date'],
    detailKeys: ['purchasedate', 'invoicedate', 'documentdate', 'dateofpurchase'],
    whereHint: 'Printed at the top of your Tax Invoice or Purchase Receipt.',
  },
  {
    fieldKeywords: ['invoice number', 'bill number', 'receipt number', 'order id'],
    detailKeys: ['invoicenumber', 'invoiceno', 'billnumber', 'receiptnumber', 'orderid'],
    whereHint: 'Top corner of your purchase invoice or retailer bill.',
  },
  {
    fieldKeywords: ['product name', 'appliance', 'item name', 'brand'],
    detailKeys: ['productname', 'brand', 'appliance', 'itemname'],
    whereHint: 'Your Product Invoice or saved Products list in AURA.',
  },
  {
    fieldKeywords: ['consumer number', 'consumer no', 'ca number', 'service connection', 'account id', 'meter number'],
    detailKeys: ['consumerno', 'consumernumber', 'canumber', 'accountnumber', 'meterno', 'meternumber'],
    whereHint: 'Printed at the top of your Electricity / Utility Bill.',
  },
  {
    fieldKeywords: ['bank account', 'account number', 'a/c no'],
    detailKeys: ['accountnumber', 'bankaccount', 'acno', 'accountno'],
    whereHint: 'Your Bank Passbook, Cheque Leaf, or Bank Statement.',
  },
  {
    fieldKeywords: ['ifsc', 'ifsc code'],
    detailKeys: ['ifsc', 'ifsccode'],
    whereHint: 'Front page of your Bank Passbook or printed on your Cheque Leaf.',
  },
  {
    fieldKeywords: ['bank name', 'branch'],
    detailKeys: ['bankname', 'branch', 'branchname'],
    whereHint: 'Your Bank Passbook or Bank Statement header.',
  },
  {
    fieldKeywords: ['pan', 'permanent account'],
    detailKeys: ['pan', 'pannumber', 'panno'],
    whereHint: 'Your PAN Card or Income Tax / Bank KYC records.',
  },
  {
    fieldKeywords: ['aadhaar', 'aadhar', 'uid'],
    detailKeys: ['aadhaar', 'aadhar', 'aadhaarnumber', 'aadhaarlast4'],
    whereHint: 'Your Aadhaar Card or e-Aadhaar PDF.',
  },
  {
    fieldKeywords: ['date of birth', 'dob', 'birth date'],
    detailKeys: ['dateofbirth', 'dob', 'birthdate'],
    whereHint: 'Your Aadhaar Card, PAN Card, or Passport.',
  },
  {
    fieldKeywords: ['claim amount', 'billed amount', 'total amount', 'amount claimed'],
    detailKeys: ['claimamount', 'totalamount', 'amount', 'billamount'],
    whereHint: 'Hospital bill, repair estimate, or final invoice total.',
  },
]

function inferWhereToFind(field: FormFieldSpec): string {
  const norm = normalizeText(field.fieldName)
  for (const grp of KEY_SYNONYM_GROUPS) {
    if (grp.fieldKeywords.some((kw) => norm.includes(kw))) {
      return grp.whereHint
    }
  }
  if (field.fieldType === 'signature') {
    return 'Sign by hand in ink after printing, or verify in person when submitting.'
  }
  return 'Check your official supporting documents or enter directly from personal records.'
}

function compactKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function collectSupportingCandidates(
  field: FormFieldSpec,
  formDoc: StoredDocument,
  documents: StoredDocument[],
  products: StoredProduct[],
  contacts: StoredContact[],
  memories: StoredMemory[],
  userProfile?: UserProfileForForm
): CandidateMatch[] {
  if (field.isUnreadable || field.fieldType === 'unclear' || field.fieldType === 'signature') {
    return []
  }

  const normField = normalizeText(field.fieldName)
  const compactField = compactKey(field.fieldName)
  const fieldTokens = tokenize(field.fieldName)
  const nonSelfPerson = isNonSelfPersonField(field.fieldName)
  const candidates: CandidateMatch[] = []
  const seenValues = new Set<string>()

  const pushCandidate = (c: CandidateMatch) => {
    const val = c.value.trim()
    if (!val) return
    const key = `${c.sourceDocumentId || 'profile'}::${val.toLowerCase()}`
    if (seenValues.has(key)) return
    seenValues.add(key)
    candidates.push({ ...c, value: val })
  }

  const matchingGroups = KEY_SYNONYM_GROUPS.filter((g) =>
    g.fieldKeywords.some((kw) => normField.includes(kw))
  )

  const fieldMatchesDetailKey = (rawKey: string): 'exact' | 'inferred' | null => {
    const ck = compactKey(rawKey)
    if (!ck) return null
    if (ck === compactField) return 'exact'
    for (const grp of matchingGroups) {
      if (grp.detailKeys.includes(ck)) return 'exact'
    }
    const keyTokens = tokenize(rawKey)
    const overlap = keyTokens.filter((t) => fieldTokens.includes(t))
    if (overlap.length >= 2) return 'inferred'
    if (overlap.length === 1 && overlap[0].length >= 5 && fieldTokens.length <= 3) return 'inferred'
    return null
  }

  // 1. Search LifeFile Documents (excluding the blank/form document itself)
  for (const doc of documents) {
    if (doc.id === formDoc.id) continue
    const ext = doc.extractedData
    if (!ext) continue
    const docTitle = getDocTitle(doc)

    // 1a. Generic extracted metadata mapping
    const directMap: Array<[string, string | number | null | undefined, boolean?]> = [
      ['customerName', ext.customerName, !nonSelfPerson],
      ['policyNumber', ext.policyNumber, true],
      ['modelNumber', ext.modelNumber, true],
      ['serialNumber', ext.serialNumber, true],
      ['purchaseDate', ext.purchaseDate, true],
      ['warrantyExpiry', ext.warrantyExpiry, true],
      ['productName', ext.productName, true],
      ['supportPhone', ext.supportPhone, nonSelfPerson || normField.includes('support')],
      ['supportEmail', ext.supportEmail, nonSelfPerson || normField.includes('support')],
      ['supportWebsite', ext.supportWebsite, nonSelfPerson || normField.includes('website')],
      ['issuer', ext.issuer, nonSelfPerson || normField.includes('company') || normField.includes('insurer') || normField.includes('hospital') || normField.includes('dealer') || normField.includes('bank')],
    ]

    for (const [key, val, allowed] of directMap) {
      if (allowed === false || val === null || val === undefined) continue
      const strVal = String(val).trim()
      if (!strVal) continue
      const matchKind = fieldMatchesDetailKey(key)
      if (matchKind) {
        pushCandidate({
          value: strVal,
          sourceLabel: docTitle,
          sourceDocumentId: doc.id,
          confidence: matchKind,
          sourceNote: `Found in ${doc.originalFilename} (${key})`,
        })
      }
    }

    // 1b. Rich key-value supportingDetails extracted from supporting records
    if (ext.supportingDetails && typeof ext.supportingDetails === 'object') {
      const nonSelfRolesInField = NON_SELF_PERSON_KEYWORDS.filter((kw) => normField.includes(kw))
      for (const [k, v] of Object.entries(ext.supportingDetails)) {
        if (typeof v !== 'string' || !v.trim()) continue
        const normKey = normalizeText(k)
        // Avoid filling self address/name/phone/email into nominee/beneficiary/hospital/branch/dealer fields
        if (
          nonSelfRolesInField.length > 0 &&
          !nonSelfRolesInField.some((role) => normKey.includes(role))
        ) {
          continue
        }
        const matchKind = fieldMatchesDetailKey(k)
        if (matchKind) {
          pushCandidate({
            value: v.trim(),
            sourceLabel: docTitle,
            sourceDocumentId: doc.id,
            confidence: matchKind,
            sourceNote: `Extracted "${k}" from ${doc.originalFilename}`,
          })
        }
      }
    }
  }

  // 2. Search Products (helpful for warranty registration / product claim forms)
  const formTextContext = normalizeText(
    `${formDoc.originalFilename} ${formDoc.extractedData?.issuer || ''} ${formDoc.extractedData?.productName || ''} ${formDoc.extractedData?.formAnalysis?.formTitle || ''}`
  )
  for (const product of products) {
    const brandOrNameMatched =
      (product.brand && formTextContext.includes(normalizeText(product.brand))) ||
      formTextContext.includes(normalizeText(product.productName))
    const productPairs: Array<[string, string | null | undefined]> = [
      ['productName', product.productName],
      ['brand', product.brand],
      ['modelNumber', product.modelNumber],
      ['serialNumber', product.serialNumber],
      ['purchaseDate', product.purchaseDate],
      ['warrantyExpiry', product.warrantyExpiry],
    ]
    for (const [key, val] of productPairs) {
      if (!val) continue
      const matchKind = fieldMatchesDetailKey(key)
      if (matchKind) {
        const confidence: 'exact' | 'inferred' =
          brandOrNameMatched || products.length === 1 ? matchKind : 'inferred'
        pushCandidate({
          value: val,
          sourceLabel: `Product: ${product.productName}`,
          sourceDocumentId: product.linkedDocumentIds[0] || null,
          confidence,
          sourceNote: brandOrNameMatched
            ? `Matched product ${product.productName}`
            : `From saved product "${product.productName}" — please confirm this is the right item`,
        })
      }
    }
  }

  // 3. Search Support Contacts when field explicitly asks for company/support/dealer contact
  if (nonSelfPerson || normField.includes('support') || normField.includes('customer care')) {
    for (const contact of contacts) {
      if (normField.includes('phone') && contact.phone) {
        pushCandidate({
          value: contact.phone,
          sourceLabel: `Contact: ${contact.companyName}`,
          sourceDocumentId: contact.linkedDocumentIds[0] || null,
          confidence: 'inferred',
          sourceNote: `Support phone saved for ${contact.companyName}`,
        })
      }
      if (normField.includes('email') && contact.email) {
        pushCandidate({
          value: contact.email,
          sourceLabel: `Contact: ${contact.companyName}`,
          sourceDocumentId: contact.linkedDocumentIds[0] || null,
          confidence: 'inferred',
          sourceNote: `Support email saved for ${contact.companyName}`,
        })
      }
    }
  }

  // 4. Account Profile (for applicant self-details, never for nominee/patient/spouse)
  if (!nonSelfPerson && userProfile) {
    if (
      userProfile.name &&
      (normField.includes('name') && !normField.includes('bank') && !normField.includes('company') && !normField.includes('product') && !normField.includes('insurer') && !normField.includes('hospital') && !normField.includes('brand') && !normField.includes('branch') && !normField.includes('file'))
    ) {
      pushCandidate({
        value: userProfile.name,
        sourceLabel: 'Account Profile',
        sourceDocumentId: null,
        confidence: 'exact',
        sourceNote: 'From your AURA account profile',
      })
    }
    if (userProfile.email && (normField.includes('email') || normField.includes('e-mail'))) {
      pushCandidate({
        value: userProfile.email,
        sourceLabel: 'Account Profile',
        sourceDocumentId: null,
        confidence: 'exact',
        sourceNote: 'From your AURA account profile',
      })
    }
    if (
      userProfile.phone &&
      (normField.includes('mobile') || normField.includes('phone') || normField.includes('contact no') || normField.includes('contact number'))
    ) {
      pushCandidate({
        value: userProfile.phone,
        sourceLabel: 'Account Profile',
        sourceDocumentId: null,
        confidence: 'exact',
        sourceNote: 'From your AURA account profile',
      })
    }
  }

  // 5. Approved Personal Memories ONLY (`approvedByUser === true`)
  const nonSelfRolesInField = NON_SELF_PERSON_KEYWORDS.filter((kw) => normField.includes(kw))
  for (const mem of memories) {
    if (!mem.approvedByUser) continue
    const normMem = normalizeText(mem.content)
    if (
      nonSelfRolesInField.length > 0 &&
      !nonSelfRolesInField.some((role) => normMem.includes(role))
    ) {
      continue
    }
    const relevant = fieldTokens.some((tok) => tok.length >= 4 && normMem.includes(tok))
    if (!relevant) continue

    // Extract value after "is" or ":" cleanly if present
    const colonMatch = mem.content.match(/(?:is|are|:)\s*(.+)$/i)
    const extractedVal = colonMatch?.[1]?.trim()
    if (extractedVal && extractedVal.length <= 160) {
      pushCandidate({
        value: extractedVal.replace(/\.$/, '').trim(),
        sourceLabel: 'Approved Personal Memory',
        sourceDocumentId: null,
        confidence: 'inferred',
        sourceNote: `From approved memory: "${mem.content}"`,
      })
    }
  }

  return candidates
}

function buildRequiredDocsChecklist(
  requiredDocs: string[],
  formDocId: string,
  documents: StoredDocument[]
): SupportingDocChecklistItem[] {
  const otherDocs = documents.filter((d) => d.id !== formDocId)

  const docKeywordSynonyms: Record<string, string[]> = {
    aadhaar: ['aadhaar', 'aadhar', 'uid', 'id proof', 'identity proof', 'address proof', 'kyc'],
    pan: ['pan', 'tax id', 'kyc', 'id proof'],
    passport: ['passport', 'id proof', 'address proof'],
    invoice: ['invoice', 'bill', 'receipt', 'purchase proof', 'proof of purchase', 'tax invoice'],
    warranty: ['warranty', 'guarantee'],
    insurance: ['policy', 'insurance', 'policy copy', 'policy schedule'],
    electricity: ['electricity', 'utility bill', 'address proof', 'power bill', 'previous bill'],
    bill: ['bill', 'invoice', 'statement', 'utility'],
    bank: ['bank', 'passbook', 'cheque', 'cancelled cheque', 'statement', 'ifsc'],
    discharge: ['discharge', 'hospital', 'medical', 'prescription', 'diagnostic'],
  }

  return requiredDocs.map((reqName) => {
    const normReq = normalizeText(reqName)
    const reqTokens = tokenize(reqName)

    const matchingDocuments: Array<{ id: string; title: string; originalFilename: string }> = []
    for (const doc of otherDocs) {
      const ext = doc.extractedData
      const searchable = normalizeText(
        [
          doc.originalFilename,
          ext?.documentTitle,
          ext?.documentType,
          ext?.documentKind,
          ext?.issuer,
          ext?.productName,
          ext?.summary,
          ext?.supportingDetails ? Object.keys(ext.supportingDetails).join(' ') : '',
          ext?.supportingDetails ? Object.values(ext.supportingDetails).join(' ') : '',
        ]
          .filter(Boolean)
          .join(' ')
      )

      let matched = reqTokens.some((tok) => tok.length >= 4 && searchable.includes(tok))
      if (!matched) {
        for (const [root, syns] of Object.entries(docKeywordSynonyms)) {
          const reqMatchesSyn = syns.some((s) => normReq.includes(s)) || normReq.includes(root)
          const docMatchesSyn = syns.some((s) => searchable.includes(s)) || searchable.includes(root)
          if (reqMatchesSyn && docMatchesSyn) {
            matched = true
            break
          }
        }
      }

      if (matched) {
        matchingDocuments.push({
          id: doc.id,
          title: getDocTitle(doc),
          originalFilename: doc.originalFilename,
        })
      }
    }

    return {
      name: reqName,
      foundInLifeFile: matchingDocuments.length > 0,
      matchingDocuments,
    }
  })
}

/**
 * Computes field-by-field guidance, LifeFile prefill candidates, required document status,
 * and completion metrics for an uploaded form document.
 */
export function analyzeFormPrefills(params: {
  formDoc: StoredDocument
  documents: StoredDocument[]
  products?: StoredProduct[]
  contacts?: StoredContact[]
  memories?: StoredMemory[]
  userProfile?: UserProfileForForm
}): FormGuideState {
  const {
    formDoc,
    documents,
    products = [],
    contacts = [],
    memories = [],
    userProfile,
  } = params

  const ext = formDoc.extractedData
  const existingAnalysis: Partial<FormAnalysis> = ext?.formAnalysis || {}
  const isForm = Boolean(existingAnalysis.isForm ?? ext?.isForm)
  const documentKind: DocumentKind =
    existingAnalysis.documentKind || ext?.documentKind || (isForm ? 'blank_form' : 'other')
  const rawFields = Array.isArray(existingAnalysis.fields) ? existingAnalysis.fields : []
  const savedAnswers = existingAnalysis.savedAnswers || {}

  const fields: FieldGuidanceItem[] = rawFields.map((field) => {
    const sensitive = isSensitiveFieldName(field)
    const unreadable = Boolean(field.isUnreadable || field.fieldType === 'unclear')
    const saved =
      savedAnswers[String(field.fieldNumber)] || savedAnswers[field.fieldName] || null
    const whereToFind = inferWhereToFind(field)

    const candidates = collectSupportingCandidates(
      field,
      formDoc,
      documents,
      products,
      contacts,
      memories,
      userProfile
    )

    // Pick best candidate (exact first)
    const bestCandidate =
      candidates.find((c) => c.confidence === 'exact') || candidates[0] || null
    const hasDistinctMultiple =
      new Set(candidates.map((c) => c.value.toLowerCase())).size > 1

    let status: FieldPrefillStatus = 'needs_input'
    let prefilledValue: string | null = null
    let source: string | null = bestCandidate?.sourceLabel || null
    let sourceDocumentId: string | null = bestCandidate?.sourceDocumentId || null
    let sourceNote: string | null = bestCandidate?.sourceNote || null
    let needsUserConfirmation = false

    const savedValue = saved?.value ? saved.value.trim() : null
    const confirmed = Boolean(saved?.confirmed)
    const skipped = Boolean(saved?.skipped)

    if (unreadable && !savedValue) {
      status = 'unclear'
      sourceNote =
        'This field label is unclear or cut off in the uploaded file. Please verify on the physical/original form.'
    } else if (savedValue) {
      if (confirmed) {
        status = 'available'
        needsUserConfirmation = false
      } else if (sensitive || hasDistinctMultiple) {
        status = 'needs_confirmation'
        needsUserConfirmation = true
      } else {
        status = 'available'
      }
      source = saved?.source || source || 'User Entry'
    } else if (bestCandidate) {
      prefilledValue = bestCandidate.value
      // Sensitive fields or ambiguous/inferred matches ALWAYS require explicit confirmation
      if (sensitive || bestCandidate.confidence === 'inferred' || hasDistinctMultiple) {
        status = 'needs_confirmation'
        needsUserConfirmation = true
        if (hasDistinctMultiple) {
          const altCount = new Set(candidates.map((c) => c.value.toLowerCase())).size
          sourceNote = `${bestCandidate.sourceNote} (${altCount} different values found across your records — please confirm).`
        } else if (sensitive) {
          sourceNote = `${bestCandidate.sourceNote} (sensitive field — confirm before using).`
        }
      } else {
        status = 'available'
        needsUserConfirmation = false
      }
    } else if (!field.required) {
      status = 'optional'
    } else {
      status = 'needs_input'
    }

    return {
      fieldNumber: field.fieldNumber,
      fieldName: field.fieldName,
      section: field.section || null,
      fieldType: field.fieldType,
      options: field.options,
      required: Boolean(field.required),
      meaning: field.meaning,
      whatToEnter: field.whatToEnter,
      example: field.example,
      isSensitive: sensitive,
      isUnreadable: unreadable,
      status,
      prefilledValue,
      savedValue,
      confirmed,
      skipped,
      source,
      sourceDocumentId,
      sourceNote,
      whereToFind,
      needsUserConfirmation,
    }
  })

  const requiredDocs = Array.isArray(existingAnalysis.requiredDocuments)
    ? existingAnalysis.requiredDocuments
    : []

  const requiredDocuments = buildRequiredDocsChecklist(requiredDocs, formDoc.id, documents)

  let readyCount = 0
  let needsConfirmationCount = 0
  let missingMandatoryCount = 0
  let unclearCount = 0
  let mandatoryCount = 0

  for (const f of fields) {
    if (f.required) mandatoryCount++
    if (f.status === 'unclear') {
      unclearCount++
      if (f.required) missingMandatoryCount++
    } else if (f.status === 'available') {
      readyCount++
    } else if (f.status === 'needs_confirmation') {
      needsConfirmationCount++
    } else if (f.required) {
      missingMandatoryCount++
    }
  }

  return {
    documentId: formDoc.id,
    originalFilename: formDoc.originalFilename,
    isForm,
    documentKind,
    formTitle:
      existingAnalysis.formTitle ||
      ext?.documentTitle ||
      ext?.summary ||
      formDoc.originalFilename,
    formPurpose:
      existingAnalysis.formPurpose ||
      ext?.summary ||
      'Complete and verify the requested fields accurately.',
    whoShouldFill: existingAnalysis.whoShouldFill || 'Applicant / Authorized Holder',
    instructions: Array.isArray(existingAnalysis.instructions)
      ? existingAnalysis.instructions
      : [],
    requiredDocuments,
    fields,
    summary: {
      totalFields: fields.length,
      mandatoryCount,
      readyCount,
      needsConfirmationCount,
      missingMandatoryCount,
      unclearCount,
    },
    formDetectionNote: existingAnalysis.formDetectionNote || null,
  }
}

/**
 * Generates a structured, copyable / downloadable text answer sheet for Step 4.
 * Only includes verified/confirmed or user-entered values — never fake examples.
 */
export function formatAnswerSheetText(state: FormGuideState): string {
  const lines: string[] = [
    `AURA FORM ANSWER SHEET`,
    `Form: ${state.formTitle}`,
    `Source File: ${state.originalFilename}`,
    `Generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    ``,
    `Note: Review every value carefully before copying onto your physical or online form.`,
    `------------------------------------------------------------`,
  ]

  for (const f of state.fields) {
    const activeVal = f.savedValue || f.prefilledValue || ''
    const displayVal = f.skipped
      ? '[Skipped optional field]'
      : f.isUnreadable && !f.savedValue
        ? '[Unclear label in document — check original form]'
        : f.fieldType === 'signature' && !f.savedValue
          ? '[Sign by hand when submitting]'
          : activeVal
            ? f.needsUserConfirmation && !f.confirmed
              ? `${activeVal}  (Suggested from ${f.source || 'records'} — confirm before final entry)`
              : `${activeVal}${f.source ? `  (Source: ${f.source})` : ''}`
            : f.required
              ? '[Missing — fill manually]'
              : '[Optional — left blank]'

    lines.push(`${f.fieldNumber}. ${f.fieldName}${f.required ? ' *' : ' (Optional)'}`)
    lines.push(`   Answer: ${displayVal}`)
    lines.push(``)
  }

  if (state.requiredDocuments.length > 0) {
    lines.push(`Supporting Documents Checklist:`)
    for (const d of state.requiredDocuments) {
      const statusLabel = d.foundInLifeFile
        ? `Available in LifeFile (${d.matchingDocuments.map((m) => m.originalFilename).join(', ')})`
        : 'Not found in LifeFile'
      lines.push(`- ${d.name}: ${statusLabel}`)
    }
  }

  return lines.join('\n')
}

export function looksLikeFormDocument(doc: StoredDocument): boolean {
  if (doc.extractedData?.isForm === true || doc.extractedData?.formAnalysis?.isForm === true) {
    return true
  }
  const kind = doc.extractedData?.documentKind
  if (kind && ['blank_form', 'application_form', 'claim_form', 'registration_form'].includes(kind)) {
    return true
  }
  const text = normalizeText(
    [doc.originalFilename, doc.extractedData?.documentTitle, doc.extractedData?.summary]
      .filter(Boolean)
      .join(' ')
  )
  const isNonForm =
    doc.extractedData?.documentType === 'Invoice' ||
    doc.extractedData?.documentType === 'Receipt' ||
    text.includes('tax invoice') ||
    text.includes('receipt')
  if (isNonForm && !text.includes('blank') && !text.includes('form')) return false

  return (
    text.includes('blank form') ||
    text.includes('personal details form') ||
    text.includes('application form') ||
    text.includes('claim form') ||
    text.includes('registration form') ||
    (/\bform\b/.test(text) && !text.includes('platform') && !text.includes('information only'))
  )
}

function detectFormQuerySignals(normQuery: string): {
  isFormQuery: boolean
  asksAllFields: boolean
  requestedFieldNumber: number | null
  asksRequiredDocs: boolean
  asksEmptyFields: boolean
  asksFindInfo: boolean
} {
  const fieldNumMatch = normQuery.match(/field\s*(?:number|no|#)?\s*(\d{1,2})\b/)
  const requestedFieldNumber = fieldNumMatch ? parseInt(fieldNumMatch[1], 10) : null

  const asksAllFields =
    normQuery.includes('what should i fill') ||
    normQuery.includes('what do i fill') ||
    normQuery.includes('what to fill') ||
    normQuery.includes('how to fill') ||
    normQuery.includes('how do i fill') ||
    normQuery.includes('fill this form') ||
    normQuery.includes('explain every field') ||
    normQuery.includes('all fields') ||
    normQuery.includes('fill in this form') ||
    normQuery.includes('complete this form') ||
    normQuery.includes('step by step') ||
    normQuery.includes('guide me') ||
    normQuery.includes('kya bharna') ||
    normQuery.includes('kya fill') ||
    normQuery.includes('kaise bhare') ||
    normQuery.includes('kaise bharna') ||
    normQuery.includes('bharna hai') ||
    normQuery.includes('form kaise')

  const asksRequiredDocs =
    (normQuery.includes('document') || normQuery.includes('doc')) &&
    (normQuery.includes('need') || normQuery.includes('require') || normQuery.includes('attach') || normQuery.includes('chahiye'))

  const asksEmptyFields =
    (normQuery.includes('empty') || normQuery.includes('missing') || normQuery.includes('left') || normQuery.includes('remaining') || normQuery.includes('baaki')) &&
    (normQuery.includes('field') || normQuery.includes('form'))

  const asksFindInfo =
    (normQuery.includes('find my') || normQuery.includes('where can i find') || normQuery.includes('from my document') || normQuery.includes('check my document'))

  const mentionsFormWord =
    normQuery.includes('form') ||
    requestedFieldNumber !== null ||
    asksAllFields ||
    asksEmptyFields

  const isFormQuery =
    asksAllFields ||
    requestedFieldNumber !== null ||
    asksRequiredDocs ||
    asksEmptyFields ||
    (mentionsFormWord && (normQuery.includes('explain') || normQuery.includes('help') || normQuery.includes('fill') || normQuery.includes('status') || normQuery.includes('guide') || normQuery.includes('field') || normQuery.includes('detail') || normQuery.includes('bhar')))

  return {
    isFormQuery,
    asksAllFields,
    requestedFieldNumber,
    asksRequiredDocs,
    asksEmptyFields,
    asksFindInfo,
  }
}

function pickTargetFormDocument(
  normQuery: string,
  documents: StoredDocument[],
  activeFormDocId?: string
): StoredDocument | null {
  const formDocs = documents.filter((d) => looksLikeFormDocument(d))

  if (activeFormDocId) {
    const exact = formDocs.find((d) => d.id === activeFormDocId)
    if (exact) return exact
  }

  if (formDocs.length === 0) return null
  if (formDocs.length === 1) return formDocs[0]

  // Score form docs by overlap with query tokens
  const qTokens = tokenize(normQuery)
  let bestDoc: StoredDocument = formDocs[0]
  let bestScore = -1

  for (const doc of formDocs) {
    const text = normalizeText(
      [
        doc.originalFilename,
        doc.extractedData?.documentTitle,
        doc.extractedData?.formAnalysis?.formTitle,
        doc.extractedData?.documentKind,
        doc.extractedData?.issuer,
        doc.extractedData?.documentType,
        doc.extractedData?.summary,
      ]
        .filter(Boolean)
        .join(' ')
    )

    let score = 0
    for (const t of qTokens) {
      if (text.includes(t)) score += 3
    }
    if (normQuery.includes('claim') && doc.extractedData?.documentKind === 'claim_form') score += 5
    if (normQuery.includes('warranty') && doc.extractedData?.documentKind === 'registration_form') score += 5
    if (normQuery.includes('bank') && text.includes('bank')) score += 5
    if (normQuery.includes('electricity') && text.includes('electricity')) score += 5

    if (score > bestScore) {
      bestScore = score
      bestDoc = doc
    }
  }

  return bestDoc
}

/**
 * Evaluates form-related conversational queries and builds grounded field + LifeFile prefill
 * instructions for the reasoning orchestrator.
 */
export function processFormIntelligence(params: {
  query: string
  documents: StoredDocument[]
  products?: StoredProduct[]
  contacts?: StoredContact[]
  memories?: StoredMemory[]
  userProfile?: UserProfileForForm
  activeFormDocId?: string
}): FormIntelligenceResult {
  const normQuery = normalizeText(params.query)
  const signals = detectFormQuerySignals(normQuery)

  const formDocs = params.documents.filter((d) => looksLikeFormDocument(d))

  const targetFormDoc = pickTargetFormDocument(normQuery, params.documents, params.activeFormDocId)

  // Handle "is this a form / what should I fill" when only non-form docs exist
  if (!targetFormDoc) {
    if (!signals.isFormQuery) {
      return {
        isFormQuery: false,
        asksAllFields: false,
        requestedFieldNumber: null,
        targetFormDoc: null,
        formState: null,
        groundedFormContext: '',
        formSources: [],
      }
    }

    const latestDoc = params.documents[0]
    const groundedFormContext = latestDoc
      ? [
          `--- FORM INTELLIGENCE ---`,
          `No blank or fillable form document is currently uploaded in LifeFile.`,
          `The most recent uploaded document is "${latestDoc.originalFilename}" (classified as ${latestDoc.extractedData?.documentKind || latestDoc.extractedData?.documentType || 'non-form document'}, isForm=false).`,
          `Tell the user honestly that none of their uploaded documents appear to be a fillable form, and do not invent form fields. Ask them to upload the form (PDF or photo) if they want step-by-step form filling guidance.`,
        ].join('\n')
      : [
          `--- FORM INTELLIGENCE ---`,
          `No form documents have been uploaded yet.`,
          `Tell the user to upload the blank form (PDF or image) first so AURA can detect every field and guide them step by step.`,
        ].join('\n')

    return {
      isFormQuery: true,
      asksAllFields: signals.asksAllFields,
      requestedFieldNumber: signals.requestedFieldNumber,
      targetFormDoc: null,
      formState: null,
      groundedFormContext,
      formSources: latestDoc ? [makeSourceRef(latestDoc)] : [],
    }
  }

  const formState = analyzeFormPrefills({
    formDoc: targetFormDoc,
    documents: params.documents,
    products: params.products,
    contacts: params.contacts,
    memories: params.memories,
    userProfile: params.userProfile,
  })

  // If user didn't ask a direct form question (e.g., "Can you find my address from my documents?" or normal chat),
  // only activate full form guidance if query explicitly signals form help OR asks about a specific field on a form.
  if (!signals.isFormQuery && !signals.asksFindInfo) {
    return {
      isFormQuery: false,
      asksAllFields: false,
      requestedFieldNumber: null,
      targetFormDoc: formDocs.length > 0 && normQuery.includes('form') ? targetFormDoc : null,
      formState: null,
      groundedFormContext: '',
      formSources: [],
    }
  }

  // Build cited sources from target form + all docs contributing prefill or required-doc matches
  const sourcesMap = new Map<string, DocumentSourceReference>()
  sourcesMap.set(targetFormDoc.id, makeSourceRef(targetFormDoc, 'Form Document'))

  const docById = new Map(params.documents.map((d) => [d.id, d]))
  for (const field of formState.fields) {
    if (field.sourceDocumentId) {
      const srcDoc = docById.get(field.sourceDocumentId)
      if (srcDoc && !sourcesMap.has(srcDoc.id)) {
        sourcesMap.set(srcDoc.id, makeSourceRef(srcDoc, field.fieldName))
      }
    }
  }
  for (const reqDoc of formState.requiredDocuments) {
    for (const m of reqDoc.matchingDocuments) {
      const srcDoc = docById.get(m.id)
      if (srcDoc && !sourcesMap.has(srcDoc.id)) {
        sourcesMap.set(srcDoc.id, makeSourceRef(srcDoc, reqDoc.name))
      }
    }
  }

  const lines: string[] = [
    `--- AI FORM FILLING GUIDE CONTEXT ---`,
    `Active Form: ${formState.formTitle} (File: ${formState.originalFilename}, ID: ${formState.documentId})`,
    `Document Kind: ${formState.documentKind}`,
    `Purpose: ${formState.formPurpose}`,
    `Who Should Fill: ${formState.whoShouldFill}`,
    `Progress Summary: ${formState.summary.totalFields} fields total | ${formState.summary.mandatoryCount} mandatory | ${formState.summary.readyCount} ready from LifeFile/Saved | ${formState.summary.needsConfirmationCount} need confirmation | ${formState.summary.missingMandatoryCount} mandatory still need input | ${formState.summary.unclearCount} unclear`,
  ]

  if (formState.instructions.length > 0) {
    lines.push(`Instructions: ${formState.instructions.join(' ; ')}`)
  }

  if (formState.requiredDocuments.length > 0) {
    lines.push(`Required Supporting Documents:`)
    for (const req of formState.requiredDocuments) {
      lines.push(
        `- ${req.name}: ${
          req.foundInLifeFile
            ? `FOUND in LifeFile -> ${req.matchingDocuments.map((m) => m.originalFilename).join(', ')}`
            : 'MISSING from LifeFile (ask user to keep ready or upload)'
        }`
      )
    }
  }

  const fieldsToInclude =
    signals.requestedFieldNumber !== null
      ? formState.fields.filter((f) => f.fieldNumber === signals.requestedFieldNumber)
      : formState.fields

  lines.push(
    signals.requestedFieldNumber !== null
      ? `Requested Field #${signals.requestedFieldNumber} Details:`
      : `All Detected Form Fields (${fieldsToInclude.length}):`
  )

  for (const f of fieldsToInclude) {
    const valDesc = f.savedValue
      ? `Saved by user: "${f.savedValue}" (${f.confirmed ? 'confirmed' : 'unconfirmed'})`
      : f.prefilledValue
        ? `Prefill match from ${f.source}: "${f.prefilledValue}" (status: ${f.status})`
        : f.isUnreadable
          ? 'UNCLEAR IN DOCUMENT — ask user to verify on original document'
          : `No LifeFile match (${f.required ? 'needs user input' : 'optional'})`

    lines.push(
      `Field ${f.fieldNumber}: "${f.fieldName}" [${f.required ? 'Mandatory' : 'Optional'} | type=${f.fieldType}${f.isSensitive ? ' | SENSITIVE' : ''}${f.section ? ` | section=${f.section}` : ''}]`
    )
    lines.push(`  - Simple meaning: ${f.meaning}`)
    lines.push(`  - What to enter: ${f.whatToEnter}`)
    lines.push(`  - Realistic example (sample only, NEVER real user data): ${f.example}`)
    lines.push(`  - Where to find it: ${f.whereToFind}`)
    lines.push(`  - Status & LifeFile match: ${valDesc}`)
  }

  if (fieldsToInclude.length === 0 && targetFormDoc.extractedData?.formAnalysis?.formDetectionNote) {
    lines.push(
      `TECHNICAL DETECTION NOTE: ${targetFormDoc.extractedData.formAnalysis.formDetectionNote}`
    )
    lines.push(
      `Explain this technical limitation clearly to the user and ask for a clearer photo or higher-resolution PDF rather than guessing fields.`
    )
  } else if (formState.fields.length > 0 && signals.requestedFieldNumber === null) {
    lines.push(
      `RESPONSE STYLE TIP: Start cleanly with "I found ${formState.fields.length} fields in your ${formState.formTitle}. Let's fill them step by step:" (or natural Hindi/Hinglish equivalent like "Mujhe aapke ${formState.formTitle} mein ${formState.fields.length} fields mile hain. Aaiye ek-ek karke dekhein:") and then clearly explain EVERY numbered field below without claiming fields are missing.`
    )
  }

  if (signals.requestedFieldNumber !== null && fieldsToInclude.length === 0) {
    lines.push(
      `Field #${signals.requestedFieldNumber} was NOT found in ${formState.originalFilename}. This form only has fields 1 to ${formState.fields.length}. Tell the user honestly.`
    )
  }

  // Also summarize all supportingDetails from LifeFile when user asks "find my address/info from documents"
  const extraSupportingLines: string[] = []
  for (const doc of params.documents) {
    const sd = doc.extractedData?.supportingDetails
    if (sd && Object.keys(sd).length > 0) {
      const pairs = Object.entries(sd)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')
      extraSupportingLines.push(`- ${doc.originalFilename} (${doc.id}): ${pairs}`)
      if (!sourcesMap.has(doc.id)) {
        sourcesMap.set(doc.id, makeSourceRef(doc, 'Supporting Details'))
      }
    }
  }
  if (extraSupportingLines.length > 0) {
    lines.push(`Supporting Facts Available Across LifeFile:`)
    lines.push(...extraSupportingLines)
  }

  return {
    isFormQuery: signals.isFormQuery || signals.asksFindInfo,
    asksAllFields: signals.asksAllFields,
    requestedFieldNumber: signals.requestedFieldNumber,
    targetFormDoc: signals.isFormQuery ? targetFormDoc : null,
    formState: signals.isFormQuery ? formState : null,
    groundedFormContext: lines.join('\n'),
    formSources: Array.from(sourcesMap.values()),
  }
}
