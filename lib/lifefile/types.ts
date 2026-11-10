export type DocumentCategory =
  | 'Bill'
  | 'Invoice'
  | 'Warranty'
  | 'Insurance'
  | 'Receipt'
  | 'Manual'
  | 'Contract'
  | 'Other'

export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type DocumentKind =
  | 'blank_form'
  | 'application_form'
  | 'claim_form'
  | 'registration_form'
  | 'invoice'
  | 'bill'
  | 'insurance_document'
  | 'warranty_card'
  | 'supporting_document'
  | 'agreement'
  | 'other'

export type FormFieldType =
  | 'text'
  | 'date'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'email'
  | 'phone'
  | 'textarea'
  | 'signature'
  | 'unclear'

export interface FormFieldSpec {
  fieldNumber: number
  fieldName: string
  section?: string | null
  fieldType: FormFieldType
  options?: string[]
  required: boolean
  meaning: string
  whatToEnter: string
  example: string
  isSensitive?: boolean
  isUnreadable?: boolean
}

export interface FormSavedAnswer {
  value: string
  confirmed: boolean
  skipped?: boolean
  source?: string | null
  updatedAt?: string
}

export type FormDetectionMethod =
  | 'acroform'
  | 'pdf_text'
  | 'gemini_pdf'
  | 'gemini_vision_pages'
  | 'manual'

export interface FormAnalysis {
  isForm: boolean
  documentKind: DocumentKind
  formTitle: string | null
  formPurpose: string | null
  whoShouldFill: string | null
  requiredDocuments: string[]
  instructions: string[]
  fields: FormFieldSpec[]
  savedAnswers?: Record<string, FormSavedAnswer>
  detectionMethods?: FormDetectionMethod[]
  formDetectionNote?: string | null
}

export interface ExtractedDocumentData {
  documentType: DocumentCategory
  documentKind?: DocumentKind
  isForm?: boolean
  documentTitle?: string | null
  userCategory?: string | null
  issuer: string | null
  customerName: string | null
  documentDate: string | null
  dueDate: string | null
  expiryDate: string | null
  totalAmount: number | null
  currency: string | null
  productName: string | null
  modelNumber: string | null
  serialNumber: string | null
  purchaseDate: string | null
  warrantyDuration: string | null
  warrantyExpiry: string | null
  policyNumber: string | null
  importantConditions: string[] | null
  contactDetails: string | null
  supportPhone?: string | null
  supportEmail?: string | null
  supportWebsite?: string | null
  supportingDetails?: Record<string, string> | null
  formAnalysis?: FormAnalysis | null
  summary: string | null
}

export interface StoredDocument {
  id: string
  originalFilename: string
  storageFilename: string
  mimeType: string
  fileSize: number
  uploadTimestamp: string
  extractionStatus: ExtractionStatus
  extractedData: ExtractedDocumentData | null
  extractionError?: string | null
}

export interface DocumentValidationResult {
  valid: boolean
  error?: string
  normalizedMimeType?: string
  sanitizedFilename?: string
}
