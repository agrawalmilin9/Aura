'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Clipboard,
  ClipboardCheck,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Info,
  Loader2,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react'
import type { FieldGuidanceItem, FormGuideState } from '@/lib/lifefile/form-assistant.ts'
import type { FormSavedAnswer } from '@/lib/lifefile/types.ts'

interface PdfInspectionInfo {
  isPdf: boolean
  hasFillableFields: boolean
  fields: Array<{ name: string; type: string }>
}

interface DraftFieldEntry {
  value: string
  confirmed: boolean
  skipped: boolean
  source?: string | null
}

function buildFieldGroups(fields: FieldGuidanceItem[]): Array<{ title: string; fields: FieldGuidanceItem[] }> {
  const bySection: Array<{ title: string; fields: FieldGuidanceItem[] }> = []
  for (const field of fields) {
    const rawSection = (field.section || '').trim() || 'Form Details'
    const last = bySection[bySection.length - 1]
    if (last && last.title === rawSection && last.fields.length < 4) {
      last.fields.push(field)
    } else if (last && last.title.startsWith(rawSection) && last.fields.length < 4) {
      last.fields.push(field)
    } else {
      const countSame = bySection.filter((g) => g.title === rawSection || g.title.startsWith(`${rawSection} (`)).length
      const groupTitle = countSame > 0 ? `${rawSection} (Part ${countSame + 1})` : rawSection
      bySection.push({ title: groupTitle, fields: [field] })
    }
  }
  return bySection
}

function StatusBadge({ status, required }: { status: FieldGuidanceItem['status']; required: boolean }) {
  if (status === 'available') {
    return (
      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#edf5ee', color: '#3b7a4b', border: '1px solid #cce3d0' }}>
        Ready / Available
      </span>
    )
  }
  if (status === 'needs_confirmation') {
    return (
      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#fef6e6', color: '#9c6514', border: '1px solid #f4dcb1' }}>
        Needs Confirmation
      </span>
    )
  }
  if (status === 'unclear') {
    return (
      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#fae9e5', color: '#b44838', border: '1px solid #f0c9bf' }}>
        Unclear in Document
      </span>
    )
  }
  if (status === 'optional' || !required) {
    return (
      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#f5f2ed', color: '#78726a', border: '1px solid #e5ded5' }}>
        Optional
      </span>
    )
  }
  return (
    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#f8efe9', color: '#b8533f', border: '1px solid #edd4cb' }}>
      Needs Your Input
    </span>
  )
}

export function FormFillingGuideModal({
  documentId,
  onClose,
  onAskAura,
  onSavedProgress,
}: {
  documentId: string | null
  onClose: () => void
  onAskAura?: (prompt: string) => void
  onSavedProgress?: () => void
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [activeGroupIdx, setActiveGroupIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [downloadingPdf, setDownloadingPdf] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  const [formState, setFormState] = useState<FormGuideState | null>(null)
  const [pdfInspection, setPdfInspection] = useState<PdfInspectionInfo | null>(null)
  const [answerSheetText, setAnswerSheetText] = useState('')
  const [drafts, setDrafts] = useState<Record<string, DraftFieldEntry>>({})
  const [copied, setCopied] = useState(false)
  const [explicitApproval, setExplicitApproval] = useState(false)
  const [allowNonFormGuide, setAllowNonFormGuide] = useState(false)

  useEffect(() => {
    if (!documentId) return
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError(null)
      setStep(1)
      setActiveGroupIdx(0)
      setExplicitApproval(false)
      setAllowNonFormGuide(false)
      try {
        const res = await fetch(`/api/documents/${documentId}/form-guide`)
        const data = await res.json()
        if (cancelled) return
        if (!res.ok || !data.success || !data.formState) {
          setError(data.error || 'Could not load form guide.')
          return
        }
        const loadedState: FormGuideState = data.formState
        setFormState(loadedState)
        setPdfInspection(data.pdfInspection || null)
        setAnswerSheetText(data.answerSheetText || '')

        const initialDrafts: Record<string, DraftFieldEntry> = {}
        for (const f of loadedState.fields) {
          const key = String(f.fieldNumber)
          if (f.savedValue || f.skipped || f.confirmed) {
            initialDrafts[key] = {
              value: f.savedValue || '',
              confirmed: f.confirmed,
              skipped: f.skipped,
              source: f.source,
            }
          } else if (f.prefilledValue && f.status === 'available' && !f.isSensitive) {
            // Safe verified non-sensitive prefill
            initialDrafts[key] = {
              value: f.prefilledValue,
              confirmed: true,
              skipped: false,
              source: f.source,
            }
          } else {
            initialDrafts[key] = {
              value: '',
              confirmed: false,
              skipped: false,
              source: f.source,
            }
          }
        }
        setDrafts(initialDrafts)
      } catch {
        if (!cancelled) setError('Network error while loading Form Filling Guide.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [documentId])

  const fieldGroups = useMemo(
    () => (formState ? buildFieldGroups(formState.fields) : []),
    [formState]
  )

  if (!documentId) return null

  const getDraft = (f: FieldGuidanceItem): DraftFieldEntry =>
    drafts[String(f.fieldNumber)] || { value: '', confirmed: false, skipped: false, source: f.source }

  const updateDraft = (fieldNum: number, patch: Partial<DraftFieldEntry>) => {
    const key = String(fieldNum)
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        value: prev[key]?.value || '',
        confirmed: prev[key]?.confirmed || false,
        skipped: prev[key]?.skipped || false,
        source: prev[key]?.source || null,
        ...patch,
      },
    }))
    setSaveNotice(null)
  }

  const persistProgress = async (nextStep?: 1 | 2 | 3 | 4) => {
    if (!documentId || !formState) {
      if (nextStep) setStep(nextStep)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload: Record<string, FormSavedAnswer> = {}
      for (const f of formState.fields) {
        const entry = getDraft(f)
        if (entry.value.trim() || entry.skipped || entry.confirmed) {
          payload[String(f.fieldNumber)] = {
            value: entry.value.trim(),
            confirmed: entry.confirmed,
            skipped: entry.skipped,
            source: entry.source || null,
          }
        }
      }

      const res = await fetch(`/api/documents/${documentId}/form-guide`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ savedAnswers: payload }),
      })
      const data = await res.json()
      if (res.ok && data.success && data.formState) {
        setFormState(data.formState)
        if (data.answerSheetText) setAnswerSheetText(data.answerSheetText)
        setSaveNotice('Progress saved to your LifeFile')
        onSavedProgress?.()
        if (nextStep) setStep(nextStep)
      } else {
        setError(data.error || 'Could not save your form progress.')
      }
    } catch {
      setError('Network error while saving form answers.')
    } finally {
      setSaving(false)
    }
  }

  const computeEffectiveStatus = (f: FieldGuidanceItem): 'ready' | 'needs_confirm' | 'missing_mandatory' | 'unclear' | 'optional' => {
    const d = getDraft(f)
    if (d.skipped && !f.required) return 'optional'
    if (d.value.trim()) {
      if (f.isSensitive && !d.confirmed) return 'needs_confirm'
      return 'ready'
    }
    if (f.prefilledValue && f.status === 'needs_confirmation') return 'needs_confirm'
    if (f.isUnreadable) return 'unclear'
    if (!f.required) return 'optional'
    return 'missing_mandatory'
  }

  const handleCopyAnswerSheet = async () => {
    if (!answerSheetText) return
    try {
      await navigator.clipboard.writeText(answerSheetText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setError('Clipboard access blocked. Please select and copy from the text box manually.')
    }
  }

  const handleDownloadAnswerSheet = () => {
    if (!answerSheetText || !formState) return
    const blob = new Blob([answerSheetText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const base = formState.originalFilename.replace(/\.[^.]+$/, '')
    a.download = `${base}-answer-sheet.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDownloadFilledPdf = async () => {
    if (!documentId || !formState || !explicitApproval) return
    setDownloadingPdf(true)
    setError(null)
    try {
      await persistProgress()
      const res = await fetch(`/api/documents/${documentId}/filled-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ explicitApproval: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.message || data.error || 'PDF form fields could not be auto-populated.')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const base = formState.originalFilename.replace(/\.pdf$/i, '')
      a.download = `filled-${base}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('Network error while preparing filled PDF.')
    } finally {
      setDownloadingPdf(false)
    }
  }

  const currentGroup = fieldGroups[activeGroupIdx] || null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Form Filling Guide"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26, 23, 20, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '16px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fffdf9',
          width: 'min(780px, 100%)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: '14px',
          border: '1px solid #e6ddd2',
          boxShadow: '0 24px 60px rgba(32, 24, 16, 0.22)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid #ece3d8',
            background: '#faf6ef',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
          }}
        >
          <div>
            <span className="section-kicker" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <FileCheck2 size={13} /> AI FORM FILLING GUIDE
            </span>
            <h3 style={{ margin: '4px 0 2px', fontSize: '18px', color: '#24201c' }}>
              {formState?.formTitle || 'Analyzing Form...'}
            </h3>
            <p style={{ margin: 0, fontSize: '11px', color: '#7a736b' }}>
              {formState ? `${formState.originalFilename} · ${formState.fields.length} field(s) detected` : 'Inspecting document & LifeFile records'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Form Filling Guide"
            style={{ background: 'none', border: 'none', color: '#7a736b', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Stepper Bar */}
        {formState && (formState.isForm || allowNonFormGuide) && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '6px',
              padding: '10px 16px',
              background: '#ffffff',
              borderBottom: '1px solid #ece3d8',
            }}
          >
            {([
              [1, '1. Understand'],
              [2, '2. Fill Fields'],
              [3, '3. Review'],
              [4, '4. Complete'],
            ] as Array<[1 | 2 | 3 | 4, string]>).map(([idx, label]) => {
              const active = step === idx
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setStep(idx)}
                  style={{
                    padding: '6px 4px',
                    borderRadius: '7px',
                    fontSize: '10px',
                    lineHeight: 1.25,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    border: active ? '1px solid var(--coral)' : '1px solid #e7dfd4',
                    background: active ? '#fae9e5' : '#faf8f4',
                    color: active ? '#b84b36' : '#5e5851',
                    textAlign: 'center',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}

        {/* Scrollable Body */}
        <div style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6b655e', fontSize: '13px' }}>
              <Loader2 size={24} className="animate-spin" style={{ margin: '0 auto 10px', color: 'var(--coral)' }} />
              Inspecting form fields and checking your LifeFile for matching values...
            </div>
          ) : error && !formState ? (
            <div style={{ padding: '16px', background: '#fae9e5', border: '1px solid #f0c9bf', borderRadius: '8px', color: '#b44838', fontSize: '13px' }}>
              {error}
            </div>
          ) : formState && !formState.isForm && !allowNonFormGuide ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ padding: '16px', background: '#fef6e6', border: '1px solid #f4dcb1', borderRadius: '10px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                <Info size={20} style={{ color: '#9c6514', flexShrink: 0, marginTop: '2px' }} />
                <div>
                  <strong style={{ fontSize: '14px', color: '#5f4010', display: 'block', marginBottom: '4px' }}>
                    This document looks like a {formState.documentKind.replace(/_/g, ' ')}, not a fillable form.
                  </strong>
                  <p style={{ margin: 0, fontSize: '12px', color: '#6b5632', lineHeight: 1.5 }}>
                    AURA does not treat invoices, bills, or supporting certificates as blank forms to fill in. You can ask AURA to explain its clauses or use facts from it to help fill another form.
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                {onAskAura && (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      const fname = formState.originalFilename
                      onClose()
                      onAskAura(`Explain what this document (${fname}) contains and whether any information in it can be used for forms.`)
                    }}
                  >
                    <Sparkles size={14} /> Ask AURA About This Document
                  </button>
                )}
                {formState.fields.length > 0 && (
                  <button type="button" className="outline-button" onClick={() => setAllowNonFormGuide(true)}>
                    Open Field View Anyway
                  </button>
                )}
              </div>
            </div>
          ) : formState ? (
            <>
              {error && (
                <div style={{ marginBottom: '12px', padding: '10px 12px', background: '#fae9e5', border: '1px solid #f0c9bf', borderRadius: '8px', color: '#b44838', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertCircle size={15} />
                  <span>{error}</span>
                </div>
              )}
              {saveNotice && (
                <div style={{ marginBottom: '12px', padding: '8px 12px', background: '#edf5ee', border: '1px solid #cce3d0', borderRadius: '8px', color: '#3b7a4b', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Check size={14} />
                  <span>{saveNotice}</span>
                </div>
              )}

              {/* STEP 1: UNDERSTAND */}
              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ padding: '14px 16px', background: '#f8efe9', border: '1px solid #eedad0', borderRadius: '10px' }}>
                    <strong style={{ display: 'block', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9c4e3d', marginBottom: '4px' }}>
                      Form Purpose &amp; Who Fills It
                    </strong>
                    <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#2b2621', lineHeight: 1.5 }}>
                      {formState.formPurpose}
                    </p>
                    <div style={{ fontSize: '12px', color: '#5c554e' }}>
                      <strong>Who should fill:</strong> {formState.whoShouldFill}
                    </div>
                  </div>

                  {formState.formDetectionNote && (
                    <div style={{ padding: '12px 14px', background: '#fff8eb', border: '1px solid #f0deb4', borderRadius: '9px', fontSize: '12px', color: '#7d4f0c', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                      <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                      <span>{formState.formDetectionNote}</span>
                    </div>
                  )}

                  {/* Quick Readiness Metrics */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))', gap: '10px' }}>
                    <div style={{ padding: '10px 12px', borderRadius: '8px', background: '#fff', border: '1px solid #e7dfd4' }}>
                      <div style={{ fontSize: '10px', color: '#8a8279', fontWeight: 600 }}>TOTAL FIELDS</div>
                      <strong style={{ fontSize: '18px', color: '#24201c' }}>{formState.fields.length}</strong>
                      <div style={{ fontSize: '11px', color: '#7a736b' }}>{formState.summary.mandatoryCount} mandatory</div>
                    </div>
                    <div style={{ padding: '10px 12px', borderRadius: '8px', background: '#edf5ee', border: '1px solid #cce3d0' }}>
                      <div style={{ fontSize: '10px', color: '#3b7a4b', fontWeight: 600 }}>FOUND IN LIFEFILE</div>
                      <strong style={{ fontSize: '18px', color: '#295b36' }}>{formState.summary.readyCount}</strong>
                      <div style={{ fontSize: '11px', color: '#3b7a4b' }}>Auto-matched safely</div>
                    </div>
                    <div style={{ padding: '10px 12px', borderRadius: '8px', background: '#fef6e6', border: '1px solid #f4dcb1' }}>
                      <div style={{ fontSize: '10px', color: '#9c6514', fontWeight: 600 }}>NEEDS CONFIRMATION</div>
                      <strong style={{ fontSize: '18px', color: '#7d4f0c' }}>{formState.summary.needsConfirmationCount}</strong>
                      <div style={{ fontSize: '11px', color: '#9c6514' }}>Verify sensitive / matched info</div>
                    </div>
                    <div style={{ padding: '10px 12px', borderRadius: '8px', background: '#faf8f4', border: '1px solid #e7dfd4' }}>
                      <div style={{ fontSize: '10px', color: '#7a736b', fontWeight: 600 }}>FILLABLE PDF</div>
                      <strong style={{ fontSize: '14px', color: '#24201c', display: 'block', marginTop: '3px' }}>
                        {pdfInspection?.hasFillableFields ? 'Yes (AcroForm)' : 'Answer Sheet Mode'}
                      </strong>
                      <div style={{ fontSize: '11px', color: '#7a736b' }}>
                        {pdfInspection?.hasFillableFields ? 'Direct PDF fill supported' : 'Scanned/static layout'}
                      </div>
                    </div>
                  </div>

                  {/* Supporting Documents Checklist */}
                  {formState.requiredDocuments.length > 0 && (
                    <div style={{ padding: '14px 16px', background: '#fff', border: '1px solid #e7dfd4', borderRadius: '10px' }}>
                      <strong style={{ display: 'block', fontSize: '13px', color: '#24201c', marginBottom: '10px' }}>
                        Supporting Documents Needed ({formState.requiredDocuments.filter((d) => d.foundInLifeFile).length}/{formState.requiredDocuments.length} in your LifeFile)
                      </strong>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {formState.requiredDocuments.map((reqDoc, idx) => (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: '10px',
                              padding: '8px 10px',
                              borderRadius: '7px',
                              background: reqDoc.foundInLifeFile ? '#f3f9f4' : '#fcfaf6',
                              border: `1px solid ${reqDoc.foundInLifeFile ? '#cde6d2' : '#ebe4da'}`,
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#24201c', fontWeight: 500 }}>
                              {reqDoc.foundInLifeFile ? (
                                <CheckCircle2 size={15} style={{ color: '#3b7a4b', flexShrink: 0 }} />
                              ) : (
                                <AlertTriangle size={15} style={{ color: '#b47418', flexShrink: 0 }} />
                              )}
                              <span>{reqDoc.name}</span>
                            </div>
                            <div style={{ fontSize: '11px' }}>
                              {reqDoc.foundInLifeFile ? (
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                  {reqDoc.matchingDocuments.map((m) => (
                                    <a
                                      key={m.id}
                                      href={`/api/documents/${m.id}/file`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      style={{ color: '#296244', fontWeight: 600, textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '3px' }}
                                    >
                                      {m.originalFilename} <ExternalLink size={10} />
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <span style={{ color: '#9c6514', fontWeight: 500 }}>Keep physical copy ready / upload later</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Form Instructions */}
                  {formState.instructions.length > 0 && (
                    <div style={{ padding: '14px 16px', background: '#fff', border: '1px solid #e7dfd4', borderRadius: '10px' }}>
                      <strong style={{ display: 'block', fontSize: '13px', color: '#24201c', marginBottom: '8px' }}>
                        Important Form Instructions
                      </strong>
                      <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#4d4740', lineHeight: 1.6 }}>
                        {formState.instructions.map((ins, idx) => (
                          <li key={idx}>{ins}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* STEP 2: FILL FIELDS STEP BY STEP */}
              {step === 2 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {fieldGroups.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#7a736b', fontSize: '13px' }}>
                      No structured fields were detected in this document.
                    </div>
                  ) : (
                    <>
                      {/* Section Navigator Pills */}
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {fieldGroups.map((grp, idx) => {
                          const isCurr = idx === activeGroupIdx
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setActiveGroupIdx(idx)}
                              style={{
                                padding: '5px 10px',
                                fontSize: '11px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: isCurr ? 700 : 500,
                                background: isCurr ? '#24201c' : '#faf6ef',
                                color: isCurr ? '#fff' : '#5e5851',
                                border: isCurr ? '1px solid #24201c' : '1px solid #e7dfd4',
                              }}
                            >
                              {grp.title} ({grp.fields.length})
                            </button>
                          )
                        })}
                      </div>

                      {/* Active Group Fields */}
                      {currentGroup && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                          {currentGroup.fields.map((field) => {
                            const draft = getDraft(field)
                            return (
                              <div
                                key={field.fieldNumber}
                                style={{
                                  padding: '15px 16px',
                                  borderRadius: '10px',
                                  background: '#ffffff',
                                  border: '1px solid #e6ddd2',
                                }}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                  <div>
                                    <strong style={{ fontSize: '14px', color: '#24201c' }}>
                                      {field.fieldNumber}. {field.fieldName}
                                    </strong>
                                    {field.required && (
                                      <span style={{ color: '#c96656', fontWeight: 700, marginLeft: '4px' }} title="Mandatory">*</span>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    {field.isSensitive && (
                                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '999px', background: '#f7eef9', color: '#6b3e82', border: '1px solid #e3cef0', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                        <ShieldAlert size={10} /> Sensitive
                                      </span>
                                    )}
                                    <StatusBadge status={field.status} required={field.required} />
                                  </div>
                                </div>

                                {/* Plain-English Guidance Box */}
                                <div style={{ padding: '10px 12px', background: '#faf8f4', borderRadius: '8px', fontSize: '12px', color: '#47423c', lineHeight: 1.5, marginBottom: '10px' }}>
                                  <div><strong>What it means:</strong> {field.meaning}</div>
                                  <div><strong>What to enter:</strong> {field.whatToEnter}</div>
                                  <div>
                                    <strong>Sample example:</strong>{' '}
                                    <span style={{ fontFamily: 'monospace', background: '#efe9df', padding: '1px 5px', borderRadius: '4px' }}>
                                      {field.example}
                                    </span>{' '}
                                    <span style={{ fontSize: '10px', color: '#8a8279' }}>(example format only — not your data)</span>
                                  </div>
                                  <div><strong>Where to find it:</strong> {field.whereToFind}</div>
                                </div>

                                {/* LifeFile Prefill Match / Confirmation Notice */}
                                {field.prefilledValue && (
                                  <div
                                    style={{
                                      marginBottom: '10px',
                                      padding: '9px 11px',
                                      borderRadius: '8px',
                                      background: field.needsUserConfirmation ? '#fef6e6' : '#edf5ee',
                                      border: `1px solid ${field.needsUserConfirmation ? '#f4dcb1' : '#cce3d0'}`,
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      gap: '10px',
                                      flexWrap: 'wrap',
                                      fontSize: '12px',
                                    }}
                                  >
                                    <div>
                                      <strong style={{ color: field.needsUserConfirmation ? '#8a560e' : '#2d663c' }}>
                                        {field.needsUserConfirmation ? 'Suggested match (please confirm): ' : 'Found in your records: '}
                                      </strong>
                                      <span style={{ fontWeight: 600 }}>{field.prefilledValue}</span>
                                      {field.source && (
                                        <span style={{ display: 'block', fontSize: '11px', color: '#6b655e' }}>
                                          Source: {field.source}
                                          {field.sourceNote ? ` · ${field.sourceNote}` : ''}
                                        </span>
                                      )}
                                    </div>
                                    <button
                                      type="button"
                                      className="outline-button"
                                      style={{ padding: '4px 10px', fontSize: '11px', background: '#fff' }}
                                      onClick={() =>
                                        updateDraft(field.fieldNumber, {
                                          value: field.prefilledValue || '',
                                          confirmed: true,
                                          skipped: false,
                                          source: field.source,
                                        })
                                      }
                                    >
                                      <Check size={12} /> {draft.value === field.prefilledValue && draft.confirmed ? 'Confirmed' : 'Use & Confirm'}
                                    </button>
                                  </div>
                                )}

                                {/* Unreadable Warning */}
                                {field.isUnreadable && (
                                  <div style={{ marginBottom: '8px', padding: '7px 10px', borderRadius: '6px', background: '#fae9e5', color: '#9f3f30', fontSize: '11px' }}>
                                    This field label is blurry or unclear in the uploaded document. Check the original form before relying on it.
                                  </div>
                                )}

                                {/* Field Input Control */}
                                {field.fieldType === 'signature' ? (
                                  <div style={{ padding: '9px 11px', background: '#f6f2eb', borderRadius: '7px', fontSize: '12px', color: '#5e5851' }}>
                                    Signature cannot be auto-filled safely. Sign this section by hand on the printed form or in person during submission.
                                  </div>
                                ) : field.fieldType === 'checkbox' ? (
                                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 500, cursor: 'pointer' }}>
                                    <input
                                      type="checkbox"
                                      checked={draft.value.toLowerCase() === 'yes' || draft.value === 'true'}
                                      onChange={(e) =>
                                        updateDraft(field.fieldNumber, {
                                          value: e.target.checked ? 'Yes' : '',
                                          confirmed: true,
                                          skipped: false,
                                          source: 'User Entry',
                                        })
                                      }
                                    />
                                    Check / Yes ({field.fieldName})
                                  </label>
                                ) : field.fieldType === 'select' && field.options && field.options.length > 0 ? (
                                  <select
                                    value={draft.value}
                                    onChange={(e) =>
                                      updateDraft(field.fieldNumber, {
                                        value: e.target.value,
                                        confirmed: true,
                                        skipped: false,
                                        source: draft.source || 'User Selection',
                                      })
                                    }
                                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #ded5c8', borderRadius: '7px', fontSize: '13px', background: '#fff' }}
                                  >
                                    <option value="">-- Select option --</option>
                                    {field.options.map((opt) => (
                                      <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                  </select>
                                ) : field.fieldType === 'textarea' ? (
                                  <textarea
                                    rows={2}
                                    value={draft.value}
                                    disabled={draft.skipped}
                                    placeholder={draft.skipped ? 'Optional field skipped' : `Enter ${field.fieldName}...`}
                                    onChange={(e) =>
                                      updateDraft(field.fieldNumber, {
                                        value: e.target.value,
                                        confirmed: true,
                                        skipped: false,
                                        source: draft.value === field.prefilledValue ? field.source : 'User Entry',
                                      })
                                    }
                                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #ded5c8', borderRadius: '7px', fontSize: '13px', resize: 'vertical' }}
                                  />
                                ) : (
                                  <input
                                    type={
                                      field.fieldType === 'date'
                                        ? 'date'
                                        : field.fieldType === 'number'
                                          ? 'number'
                                          : field.fieldType === 'email'
                                            ? 'email'
                                            : 'text'
                                    }
                                    value={draft.value}
                                    disabled={draft.skipped}
                                    placeholder={draft.skipped ? 'Optional field skipped' : `Enter ${field.fieldName}...`}
                                    onChange={(e) =>
                                      updateDraft(field.fieldNumber, {
                                        value: e.target.value,
                                        confirmed: true,
                                        skipped: false,
                                        source: e.target.value === field.prefilledValue ? field.source : 'User Entry',
                                      })
                                    }
                                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #ded5c8', borderRadius: '7px', fontSize: '13px' }}
                                  />
                                )}

                                {!field.required && (
                                  <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateDraft(field.fieldNumber, {
                                          skipped: !draft.skipped,
                                          value: !draft.skipped ? '' : draft.value,
                                          confirmed: false,
                                        })
                                      }
                                      style={{ background: 'none', border: 'none', color: '#7a736b', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                                    >
                                      {draft.skipped ? 'Undo skip' : 'Skip optional field'}
                                    </button>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* STEP 3: REVIEW */}
              {step === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ padding: '12px 14px', background: '#faf6ef', border: '1px solid #e7dfd4', borderRadius: '9px', fontSize: '12px', color: '#4d4740' }}>
                    Review every answer below before generating your copyable answer sheet or filled PDF. Click <strong>Edit</strong> to jump directly to any field.
                  </div>
                  {formState.fields.map((field) => {
                    const draft = getDraft(field)
                    const eff = computeEffectiveStatus(field)
                    const displayValue = draft.skipped
                      ? 'Skipped optional field'
                      : draft.value.trim() || (field.prefilledValue ? `${field.prefilledValue} (awaiting confirmation)` : '')

                    return (
                      <div
                        key={field.fieldNumber}
                        style={{
                          padding: '12px 14px',
                          borderRadius: '9px',
                          border: `1px solid ${eff === 'missing_mandatory' || eff === 'unclear' ? '#eec4b9' : eff === 'needs_confirm' ? '#f2d9a8' : '#e6ddd2'}`,
                          background: eff === 'missing_mandatory' ? '#fdf4f2' : eff === 'needs_confirm' ? '#fffaf0' : '#fff',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '12px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: '200px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: '#24201c' }}>
                            {field.fieldNumber}. {field.fieldName} {field.required ? '*' : '(Optional)'}
                          </div>
                          <div style={{ fontSize: '13px', marginTop: '3px', color: displayValue ? '#2b2621' : '#b44838' }}>
                            {displayValue || (field.fieldType === 'signature' ? 'Sign manually when submitting' : 'Still empty — needs your input')}
                          </div>
                          {draft.source && displayValue && !draft.skipped && (
                            <div style={{ fontSize: '10px', color: '#7a736b', marginTop: '2px' }}>
                              Source: {draft.source}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          {eff === 'needs_confirm' && (field.prefilledValue || draft.value) && (
                            <button
                              type="button"
                              className="primary-button"
                              style={{ padding: '4px 10px', fontSize: '11px' }}
                              onClick={() =>
                                updateDraft(field.fieldNumber, {
                                  value: draft.value || field.prefilledValue || '',
                                  confirmed: true,
                                  skipped: false,
                                  source: draft.source || field.source,
                                })
                              }
                            >
                              Confirm Value
                            </button>
                          )}
                          <button
                            type="button"
                            className="outline-button"
                            style={{ padding: '4px 10px', fontSize: '11px' }}
                            onClick={() => {
                              const grpIdx = fieldGroups.findIndex((g) =>
                                g.fields.some((gf) => gf.fieldNumber === field.fieldNumber)
                              )
                              setActiveGroupIdx(grpIdx >= 0 ? grpIdx : 0)
                              setStep(2)
                            }}
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* STEP 4: COMPLETE */}
              {step === 4 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ padding: '14px 16px', background: '#edf5ee', border: '1px solid #cce3d0', borderRadius: '10px', fontSize: '12px', color: '#295b36' }}>
                    <strong>Your answers are ready.</strong> AURA never auto-submits forms on your behalf — always double-check every field before submitting to an insurer, bank, or portal.
                  </div>

                  {/* Approval Gate */}
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px', borderRadius: '9px', background: '#faf6ef', border: '1px solid #e6ddd2', fontSize: '12px', color: '#24201c', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={explicitApproval}
                      onChange={(e) => setExplicitApproval(e.target.checked)}
                      style={{ marginTop: '2px' }}
                    />
                    <span>
                      <strong>Confirm export approval:</strong> I have reviewed my filled and prefilled values and confirm I want to copy or download them.
                    </span>
                  </label>

                  {/* AcroForm PDF Fill Option OR Honest Fallback Explanation */}
                  <div style={{ padding: '14px 16px', borderRadius: '10px', background: '#fff', border: '1px solid #e6ddd2' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <div>
                        <strong style={{ display: 'block', fontSize: '13px', color: '#24201c' }}>
                          <FileText size={14} style={{ display: 'inline', verticalAlign: '-2px', marginRight: '5px' }} />
                          {pdfInspection?.hasFillableFields
                            ? 'Download Filled PDF Form (AcroForm Supported)'
                            : 'Structured Answer Sheet (Safe Copy Mode)'}
                        </strong>
                        <span style={{ fontSize: '11px', color: '#7a736b' }}>
                          {pdfInspection?.hasFillableFields
                            ? `${pdfInspection.fields.length} fillable PDF field(s) detected. AURA will populate confirmed answers into the official PDF.`
                            : 'This file is an image or flat PDF without interactive form fields, so use the clean Answer Sheet below.'}
                        </span>
                      </div>
                      {pdfInspection?.hasFillableFields && (
                        <button
                          type="button"
                          className="primary-button"
                          disabled={!explicitApproval || downloadingPdf}
                          onClick={handleDownloadFilledPdf}
                        >
                          {downloadingPdf ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                          {downloadingPdf ? 'Generating PDF...' : 'Download Filled PDF'}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Copyable & Downloadable Answer Sheet */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                      <strong style={{ fontSize: '13px', color: '#24201c' }}>Complete Copyable Answer Sheet</strong>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          className="outline-button"
                          style={{ padding: '6px 11px', fontSize: '11px' }}
                          onClick={handleCopyAnswerSheet}
                        >
                          {copied ? <ClipboardCheck size={13} /> : <Clipboard size={13} />}
                          {copied ? 'Copied!' : 'Copy Answer Sheet'}
                        </button>
                        <button
                          type="button"
                          className="outline-button"
                          style={{ padding: '6px 11px', fontSize: '11px' }}
                          onClick={handleDownloadAnswerSheet}
                        >
                          <Download size={13} /> Download .TXT Summary
                        </button>
                      </div>
                    </div>
                    <textarea
                      readOnly
                      rows={11}
                      value={answerSheetText}
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '8px',
                        border: '1px solid #e2d8cb',
                        background: '#fcfaf6',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                        lineHeight: 1.5,
                        color: '#2b2621',
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer Controls */}
        {formState && (formState.isForm || allowNonFormGuide) && (
          <div
            style={{
              padding: '14px 22px',
              borderTop: '1px solid #ece3d8',
              background: '#faf6ef',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: '8px' }}>
              {step === 2 && activeGroupIdx > 0 ? (
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => setActiveGroupIdx((i) => Math.max(0, i - 1))}
                >
                  <ArrowLeft size={14} /> Previous Section
                </button>
              ) : step > 1 ? (
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : 1))}
                >
                  <ArrowLeft size={14} /> Previous Step
                </button>
              ) : (
                <button type="button" className="outline-button" onClick={onClose}>
                  Close
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {step === 2 && (
                <button
                  type="button"
                  className="outline-button"
                  disabled={saving}
                  onClick={() => persistProgress()}
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                  Save Progress
                </button>
              )}
              {step === 1 && (
                <button type="button" className="primary-button" onClick={() => setStep(2)}>
                  Start Step-by-Step Filling <ArrowRight size={14} />
                </button>
              )}
              {step === 2 && activeGroupIdx < fieldGroups.length - 1 && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={saving}
                  onClick={async () => {
                    await persistProgress()
                    setActiveGroupIdx((i) => Math.min(fieldGroups.length - 1, i + 1))
                  }}
                >
                  Save &amp; Next Section <ArrowRight size={14} />
                </button>
              )}
              {step === 2 && activeGroupIdx >= fieldGroups.length - 1 && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={saving}
                  onClick={() => persistProgress(3)}
                >
                  Save &amp; Review Answers <ArrowRight size={14} />
                </button>
              )}
              {step === 3 && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={saving}
                  onClick={() => persistProgress(4)}
                >
                  Continue to Complete <ArrowRight size={14} />
                </button>
              )}
              {step === 4 && (
                <button type="button" className="primary-button" onClick={onClose}>
                  Done
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
