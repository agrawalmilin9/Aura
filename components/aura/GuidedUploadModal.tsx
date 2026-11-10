'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  HelpCircle,
  Loader2,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import type { DocumentCategory, ExtractedDocumentData, StoredDocument } from '@/lib/lifefile/types.ts'
import { postDocumentUpload } from '@/lib/lifefile/client-upload.ts'
import { CameraCaptureModal } from './CameraCaptureModal.tsx'

export interface GuidedCategoryInfo {
  id: string
  label: string
  defaultDocType: DocumentCategory
  belongsHere: string
  auraExtracts: string
  whyHelpful: string
  example: string
}

export const GUIDED_CATEGORIES: GuidedCategoryInfo[] = [
  {
    id: 'utility-bills',
    label: 'Electricity / Water / Gas Bills',
    defaultDocType: 'Bill',
    belongsHere: 'Monthly electricity, piped gas, LPG cylinder, broadband, or water utility bills.',
    auraExtracts: 'Utility company, bill amount, billing date, due date, and customer helpline.',
    whyHelpful: 'AURA reminds you before due dates so you never miss a bill payment or incur late fees.',
    example: 'Adani Electricity Oct 2026 bill (PDF or photo)',
  },
  {
    id: 'shopping-invoices',
    label: 'Shopping Invoices / Receipts',
    defaultDocType: 'Invoice',
    belongsHere: 'Online or in-store purchase bills and GST tax invoices for electronics, appliances, or furniture.',
    auraExtracts: 'Seller/brand, product name, model number, purchase date, total price, and support contacts.',
    whyHelpful: 'Links the invoice directly to your product record for warranty claims, exchanges, and resale.',
    example: 'LG Washing Machine GST Invoice (PDF or photo)',
  },
  {
    id: 'warranty-cards',
    label: 'Warranty Cards',
    defaultDocType: 'Warranty',
    belongsHere: 'Product warranty slips, extended protection certificates, or stamped warranty cards.',
    auraExtracts: 'Product name, serial/model number, warranty duration, expiry date, and key exclusions.',
    whyHelpful: 'Tracks when coverage ends and lets AURA generate a claim checklist or support email.',
    example: 'MacBook Air AppleCare card or TV warranty slip',
  },
  {
    id: 'insurance-docs',
    label: 'Insurance Documents',
    defaultDocType: 'Insurance',
    belongsHere: 'Health, term life, car, two-wheeler, or home insurance policy schedules and renewal notices.',
    auraExtracts: 'Insurer name, policy number, policyholder, premium amount, expiry date, and key clauses.',
    whyHelpful: 'Keeps renewal dates, coverage terms, and insurer helplines ready during an emergency.',
    example: 'HDFC Ergo Health Insurance Policy PDF',
  },
  {
    id: 'bank-financial',
    label: 'Bank / Financial Documents',
    defaultDocType: 'Other',
    belongsHere: 'Loan schedules, fixed deposit receipts, investment statements, or Form 16 tax summaries.',
    auraExtracts: 'Institution name, account/reference number, statement date, amounts, and important maturity dates.',
    whyHelpful: 'Organizes maturity dates and tax filing proofs cleanly without hunting through email.',
    example: 'Fixed Deposit Advice or Mutual Fund statement PDF',
  },
  {
    id: 'identity-personal',
    label: 'Identity / Personal Documents',
    defaultDocType: 'Other',
    belongsHere: 'Passport expiry page, driving license renewal notice, voter slip, or vehicle RC document.',
    auraExtracts: 'Document title, holder name, issuing authority, issue date, and expiry/renewal date.',
    whyHelpful: 'Helps AURA remind you months before passport or license renewals.',
    example: 'Driving License front/back photo for expiry tracking',
  },
  {
    id: 'medical-docs',
    label: 'Medical Documents',
    defaultDocType: 'Other',
    belongsHere: 'Lab reports, hospital discharge summaries, prescriptions, or diagnostic receipts.',
    auraExtracts: 'Clinic/hospital name, patient name, report date, billed amount, and follow-up instructions.',
    whyHelpful: 'Makes insurance reimbursement and doctor follow-ups effortless.',
    example: 'Blood test invoice or hospital discharge summary PDF',
  },
  {
    id: 'education-docs',
    label: 'Education Documents',
    defaultDocType: 'Other',
    belongsHere: 'Course fee receipts, scholarship letters, admit cards, or degree certificates.',
    auraExtracts: 'Institution name, student name, fee amount, submission/exam deadlines, and reference number.',
    whyHelpful: 'Keeps academic proofs and fee deadlines organized in one private place.',
    example: 'University semester fee receipt or certificate PDF',
  },
  {
    id: 'agreements-contracts',
    label: 'Agreements / Contracts',
    defaultDocType: 'Contract',
    belongsHere: 'Rental agreements, society maintenance contracts, AMC service plans, or subscriptions.',
    auraExtracts: 'Party/company name, monthly/annual fee, start date, lock-in clauses, and expiry date.',
    whyHelpful: 'Lets you ask AURA in plain English about notice periods, deposits, and penalties.',
    example: '11-month House Rental Agreement PDF',
  },
  {
    id: 'other-docs',
    label: 'Other Documents',
    defaultDocType: 'Other',
    belongsHere: 'Any useful manual, booking confirmation, repair bill, or everyday personal record.',
    auraExtracts: 'Document title, organization, key dates, amounts, and plain-language summary.',
    whyHelpful: 'Keeps everything searchable inside LifeFile so you can ask AURA anytime.',
    example: 'Product user manual or service technician receipt',
  },
]

const DOC_TYPE_OPTIONS: DocumentCategory[] = [
  'Bill',
  'Invoice',
  'Warranty',
  'Insurance',
  'Receipt',
  'Manual',
  'Contract',
  'Other',
]

interface GuidedUploadModalProps {
  open: boolean
  onClose: () => void
  onSaved: (doc: StoredDocument) => void
  initialUseCamera?: boolean
}

export function GuidedUploadModal({
  open,
  onClose,
  onSaved,
  initialUseCamera = false,
}: GuidedUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('utility-bills')
  const [showHelpGuide, setShowHelpGuide] = useState(false)
  const [cameraOpen, setCameraOpen] = useState(false)

  useEffect(() => {
    if (open && initialUseCamera) {
      setCameraOpen(true)
    } else if (!open) {
      setCameraOpen(false)
    }
  }, [open, initialUseCamera])

  const [step, setStep] = useState<'select' | 'review'>('select')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extractionWarning, setExtractionWarning] = useState<string | null>(null)

  // Editable review state (step C)
  const [docType, setDocType] = useState<DocumentCategory>('Bill')
  const [docTitle, setDocTitle] = useState('')
  const [issuer, setIssuer] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [totalAmount, setTotalAmount] = useState('')
  const [currency, setCurrency] = useState('₹')
  const [documentDate, setDocumentDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [warrantyDuration, setWarrantyDuration] = useState('')
  const [warrantyExpiry, setWarrantyExpiry] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')
  const [importantConditions, setImportantConditions] = useState('')
  const [contactDetails, setContactDetails] = useState('')
  const [summary, setSummary] = useState('')
  const [rawExtracted, setRawExtracted] = useState<ExtractedDocumentData | null>(null)

  if (!open) return null

  const activeCategory =
    GUIDED_CATEGORIES.find((c) => c.id === selectedCategoryId) || GUIDED_CATEGORIES[0]

  const resetModalState = () => {
    setStep('select')
    setSelectedFile(null)
    setIsAnalyzing(false)
    setIsSaving(false)
    setError(null)
    setExtractionWarning(null)
    setRawExtracted(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const populateReviewFields = (
    data: ExtractedDocumentData | null,
    file: File,
    fallbackCategory: GuidedCategoryInfo
  ) => {
    setRawExtracted(data)
    setDocType(data?.documentType || fallbackCategory.defaultDocType)
    setDocTitle(data?.documentTitle || file.name.replace(/\.[^.]+$/, ''))
    setIssuer(data?.issuer || '')
    setCustomerName(data?.customerName || '')
    setTotalAmount(data?.totalAmount != null ? String(data.totalAmount) : '')
    setCurrency(data?.currency || '₹')
    setDocumentDate(data?.documentDate || '')
    setDueDate(data?.dueDate || '')
    setExpiryDate(data?.expiryDate || '')
    setWarrantyDuration(data?.warrantyDuration || '')
    setWarrantyExpiry(data?.warrantyExpiry || '')
    setPolicyNumber(data?.policyNumber || '')
    setImportantConditions(
      Array.isArray(data?.importantConditions) && data.importantConditions.length > 0
        ? data.importantConditions.join('\n')
        : ''
    )
    setContactDetails(data?.contactDetails || '')
    setSummary(data?.summary || '')
  }

  const handleFileChosen = async (file: File) => {
    setError(null)
    setExtractionWarning(null)
    setSelectedFile(file)
    setIsAnalyzing(true)

    try {
      const res = await postDocumentUpload({
        endpoint: '/api/documents/preview',
        file,
        categoryHint: activeCategory.label,
      })
      const data = await res.json().catch(() => null)

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Could not process this document file.')
      }

      populateReviewFields(data.extractedData || null, file, activeCategory)
      if (data.extractionStatus === 'failed') {
        setExtractionWarning(
          data.extractionError ||
            'Automatic extraction could not read every detail. Missing fields are marked "Not found" — you can fill or adjust anything before saving.'
        )
      }
      setStep('review')
    } catch (err: any) {
      setError(err?.message || 'Failed to analyze the selected file.')
      setSelectedFile(null)
    } finally {
      setIsAnalyzing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleSaveReviewedDocument = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFile) return

    setIsSaving(true)
    setError(null)
    try {
      const parsedAmount = totalAmount.trim()
        ? Number(totalAmount.replace(/[₹$,\s]/g, ''))
        : null

      const reviewedMetadata = {
        documentType: docType,
        documentKind: rawExtracted?.documentKind || undefined,
        isForm: rawExtracted?.isForm ?? Boolean(rawExtracted?.formAnalysis?.isForm),
        documentTitle: docTitle.trim() || null,
        userCategory: activeCategory.label,
        issuer: issuer.trim() || null,
        customerName: customerName.trim() || null,
        totalAmount: parsedAmount !== null && !Number.isNaN(parsedAmount) ? parsedAmount : null,
        currency: currency.trim() || '₹',
        documentDate: documentDate.trim() || null,
        dueDate: dueDate.trim() || null,
        expiryDate: expiryDate.trim() || null,
        warrantyDuration: warrantyDuration.trim() || null,
        warrantyExpiry: warrantyExpiry.trim() || null,
        policyNumber: policyNumber.trim() || null,
        importantConditions: importantConditions
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        contactDetails: contactDetails.trim() || null,
        summary: summary.trim() || null,
        productName: rawExtracted?.productName || null,
        modelNumber: rawExtracted?.modelNumber || null,
        serialNumber: rawExtracted?.serialNumber || null,
        purchaseDate: rawExtracted?.purchaseDate || null,
        supportPhone: rawExtracted?.supportPhone || null,
        supportEmail: rawExtracted?.supportEmail || null,
        supportWebsite: rawExtracted?.supportWebsite || null,
        supportingDetails: rawExtracted?.supportingDetails || null,
        formAnalysis: rawExtracted?.formAnalysis || null,
      }

      const res = await postDocumentUpload({
        endpoint: '/api/documents',
        file: selectedFile,
        categoryHint: activeCategory.label,
        reviewedMetadata,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.success || !data?.document) {
        throw new Error(data?.error || 'Could not save document to LifeFile.')
      }

      onSaved(data.document)
      resetModalState()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Unexpected error saving document.')
    } finally {
      setIsSaving(false)
    }
  }

  const notFoundTag = (val: string) =>
    !val.trim() ? (
      <span
        style={{
          fontSize: '10px',
          padding: '1px 6px',
          borderRadius: '4px',
          background: '#f2f0ea',
          color: '#7a766e',
          marginLeft: '6px',
          fontWeight: 500,
        }}
      >
        Not found
      </span>
    ) : null

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.52)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '14px',
        }}
        onClick={() => {
          resetModalState()
          onClose()
        }}
      >
        <div
          className="panel"
          style={{
            width: 'min(760px, 100%)',
            maxHeight: '92vh',
            overflowY: 'auto',
            background: '#fff',
            borderRadius: '14px',
            padding: '24px',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '10px',
              marginBottom: '16px',
            }}
          >
            <div>
              <span className="section-kicker">GUIDED DOCUMENT UPLOAD</span>
              <h2 style={{ margin: '4px 0 4px', fontSize: '20px' }}>
                {step === 'select' ? 'Add a document to LifeFile' : 'Review extracted details before saving'}
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: '12px' }}>
                {step === 'select'
                  ? 'Pick a category to see examples, or directly upload / capture with your camera.'
                  : 'AURA only fills details explicitly found in your document. Edit anything below or save as-is.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                resetModalState()
                onClose()
              }}
              aria-label="Close guided upload"
              style={{ background: 'none', border: 'none', color: '#78746c', padding: '4px' }}
            >
              <X size={20} />
            </button>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                background: '#fae9e5',
                border: '1px solid #f0d4cc',
                color: '#c96656',
                borderRadius: '8px',
                fontSize: '12px',
                marginBottom: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          {step === 'select' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Step A: Choose Category */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
                  Step 1 · Choose document category
                </label>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(195px, 1fr))',
                    gap: '8px',
                  }}
                >
                  {GUIDED_CATEGORIES.map((cat) => {
                    const selected = cat.id === selectedCategoryId
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategoryId(cat.id)}
                        style={{
                          textAlign: 'left',
                          padding: '9px 11px',
                          borderRadius: '8px',
                          border: selected ? '1.5px solid var(--coral)' : '1px solid var(--border)',
                          background: selected ? '#fdf4f1' : '#faf9f7',
                          color: 'var(--ink)',
                          fontSize: '12px',
                          fontWeight: selected ? 600 : 500,
                        }}
                      >
                        {cat.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Step B: Simple English Explanation */}
              <div
                style={{
                  background: '#faf8f4',
                  border: '1px solid #eae6dc',
                  borderRadius: '10px',
                  padding: '14px 16px',
                  fontSize: '12px',
                  lineHeight: 1.55,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', color: 'var(--coral)', fontWeight: 700 }}>
                  <Sparkles size={14} />
                  <span>About {activeCategory.label}</span>
                </div>
                <p style={{ margin: '0 0 6px' }}>
                  <strong>What belongs here:</strong> {activeCategory.belongsHere}
                </p>
                <p style={{ margin: '0 0 6px' }}>
                  <strong>What AURA extracts:</strong> {activeCategory.auraExtracts}
                </p>
                <p style={{ margin: '0 0 6px' }}>
                  <strong>Why it helps:</strong> {activeCategory.whyHelpful}
                </p>
                <p style={{ margin: 0, color: '#6b675f' }}>
                  <strong>Example:</strong> {activeCategory.example}
                </p>
              </div>

              {/* Step C: File Upload OR Camera Action */}
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>
                  Step 2 · Upload file or scan with camera (PDF, JPG, JPEG, PNG, WEBP · max 10 MB)
                </label>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleFileChosen(f)
                  }}
                  style={{ display: 'none' }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isAnalyzing}
                    style={{
                      padding: '18px 14px',
                      borderRadius: '10px',
                      border: '1.5px dashed #cbc7be',
                      background: '#fff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      textAlign: 'center',
                    }}
                  >
                    {isAnalyzing ? (
                      <Loader2 size={22} className="animate-spin" style={{ color: 'var(--coral)' }} />
                    ) : (
                      <Upload size={22} style={{ color: 'var(--coral)' }} />
                    )}
                    <strong style={{ fontSize: '13px', color: 'var(--ink)' }}>
                      {isAnalyzing ? 'Reading document with Gemini...' : 'Choose File from Device'}
                    </strong>
                    <span className="muted" style={{ fontSize: '11px' }}>
                      PDF, JPG, JPEG, PNG, or WEBP
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCameraOpen(true)}
                    disabled={isAnalyzing}
                    style={{
                      padding: '18px 14px',
                      borderRadius: '10px',
                      border: '1.5px dashed #cbc7be',
                      background: '#fff',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '6px',
                      textAlign: 'center',
                    }}
                  >
                    <Camera size={22} style={{ color: 'var(--coral)' }} />
                    <strong style={{ fontSize: '13px', color: 'var(--ink)' }}>Use Camera</strong>
                    <span className="muted" style={{ fontSize: '11px' }}>
                      Capture paper bills, receipts &amp; warranty cards
                    </span>
                  </button>
                </div>
              </div>

              {/* Step D: Helpful guidance */}
              <div style={{ border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setShowHelpGuide((v) => !v)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: '#faf9f7',
                    border: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--ink)',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <HelpCircle size={14} style={{ color: 'var(--coral)' }} />
                    What should I upload? (Quick examples &amp; tips)
                  </span>
                  {showHelpGuide ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
                {showHelpGuide && (
                  <div style={{ padding: '12px 14px', fontSize: '12px', lineHeight: 1.55, color: '#4d4a45', background: '#fff' }}>
                    <p style={{ margin: '0 0 8px' }}>
                      <strong>Warranty Card:</strong> Upload the warranty slip provided with your product. AURA can identify the warranty period, product details, and expiry date. You can also upload the purchase invoice for better product tracking.
                    </p>
                    <p style={{ margin: '0 0 8px' }}>
                      <strong>Electricity Bill:</strong> Upload your latest electricity bill PDF or clear photo. AURA identifies the bill amount, due date, provider, and billing cycle.
                    </p>
                    <p style={{ margin: 0 }}>
                      <strong>Insurance Policy:</strong> Upload the policy schedule PDF to track renewal due dates, policy numbers, coverage conditions, and customer-care helplines.
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSaveReviewedDocument} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {selectedFile && (
                <div
                  style={{
                    padding: '9px 12px',
                    background: '#faf9f7',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    fontSize: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                    <FileText size={14} style={{ color: 'var(--coral)' }} />
                    {selectedFile.name} ({activeCategory.label})
                  </span>
                  <button
                    type="button"
                    className="outline-button"
                    style={{ fontSize: '11px', padding: '4px 9px' }}
                    onClick={resetModalState}
                  >
                    Choose Different File
                  </button>
                </div>
              )}

              {rawExtracted?.isForm && (
                <div
                  style={{
                    padding: '9px 12px',
                    background: '#f8efe9',
                    border: '1px solid #eedad0',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#9c4e3d',
                  }}
                >
                  <strong>Form Detected ({rawExtracted.formAnalysis?.fields?.length || 0} fields):</strong> After saving, open the interactive <strong>AI Form Guide</strong> or ask AURA what to fill step by step.
                </div>
              )}

              {extractionWarning && (
                <div
                  style={{
                    padding: '9px 12px',
                    background: '#fff8eb',
                    border: '1px solid #f0deb4',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#8a6116',
                  }}
                >
                  {extractionWarning}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Document Title / Name {notFoundTag(docTitle)}
                  </label>
                  <input
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    placeholder="Not found"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Detected Document Type
                  </label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as DocumentCategory)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px', background: '#fff' }}
                  >
                    {DOC_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Company / Organization {notFoundTag(issuer)}
                  </label>
                  <input
                    value={issuer}
                    onChange={(e) => setIssuer(e.target.value)}
                    placeholder="Not found"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Person / Account Holder {notFoundTag(customerName)}
                  </label>
                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Not found"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Amount ({currency || '₹'}) {notFoundTag(totalAmount)}
                  </label>
                  <input
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    placeholder="Not found"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Issue Date {notFoundTag(documentDate)}
                  </label>
                  <input
                    value={documentDate}
                    onChange={(e) => setDocumentDate(e.target.value)}
                    placeholder="Not found (YYYY-MM-DD)"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Due Date {notFoundTag(dueDate)}
                  </label>
                  <input
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    placeholder="Not found (YYYY-MM-DD)"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Expiry Date {notFoundTag(expiryDate)}
                  </label>
                  <input
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    placeholder="Not found (YYYY-MM-DD)"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Warranty Period {notFoundTag(warrantyDuration)}
                  </label>
                  <input
                    value={warrantyDuration}
                    onChange={(e) => setWarrantyDuration(e.target.value)}
                    placeholder="Not found (e.g. 2 Years)"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Warranty Expiry Date {notFoundTag(warrantyExpiry)}
                  </label>
                  <input
                    value={warrantyExpiry}
                    onChange={(e) => setWarrantyExpiry(e.target.value)}
                    placeholder="Not found (YYYY-MM-DD)"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Reference / Policy Number {notFoundTag(policyNumber)}
                  </label>
                  <input
                    value={policyNumber}
                    onChange={(e) => setPolicyNumber(e.target.value)}
                    placeholder="Not found"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                    Support / Helpline Contact {notFoundTag(contactDetails)}
                  </label>
                  <input
                    value={contactDetails}
                    onChange={(e) => setContactDetails(e.target.value)}
                    placeholder="Not found"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Important Conditions / Notes {notFoundTag(importantConditions)}
                </label>
                <textarea
                  rows={2}
                  value={importantConditions}
                  onChange={(e) => setImportantConditions(e.target.value)}
                  placeholder="Not found (one condition per line)"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
                  Plain-Language Summary {notFoundTag(summary)}
                </label>
                <textarea
                  rows={2}
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="Not found"
                  style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '13px' }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '8px',
                  flexWrap: 'wrap',
                  marginTop: '6px',
                  paddingTop: '12px',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => {
                    resetModalState()
                    onClose()
                  }}
                  disabled={isSaving}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-button" disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Saving to LifeFile...
                    </>
                  ) : (
                    <>
                      <Check size={14} /> Save to LifeFile
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      <CameraCaptureModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onAcceptFile={(capturedFile) => {
          setCameraOpen(false)
          handleFileChosen(capturedFile)
        }}
        onFallbackUpload={() => fileInputRef.current?.click()}
      />
    </>
  )
}
