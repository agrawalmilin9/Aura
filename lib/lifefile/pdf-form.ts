import path from 'node:path'
import fsSync from 'node:fs'
import { pathToFileURL } from 'node:url'
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFRadioGroup,
  PDFTextField,
} from 'pdf-lib'
import type { FormFieldSpec, FormFieldType } from './types.ts'

export interface AcroFormFieldSummary {
  name: string
  type: FormFieldType
  options?: string[]
}

export interface PdfInspectionResult {
  isPdf: boolean
  hasFillableFields: boolean
  fields: AcroFormFieldSummary[]
}

export interface PdfPrintedPage {
  pageNumber: number
  textLines: string[]
  fullText: string
  charCount: number
  candidateFields: FormFieldSpec[]
}

export interface PdfTextExtractionResult {
  isPdf: boolean
  pageCount: number
  isLikelyScanned: boolean
  totalChars: number
  pages: PdfPrintedPage[]
  combinedText: string
  candidateFields: FormFieldSpec[]
}

export interface PdfRenderedPageImage {
  pageNumber: number
  pngBuffer: Buffer
  width: number
  height: number
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerFile = path.join(
    process.cwd(),
    'node_modules',
    'pdfjs-dist',
    'legacy',
    'build',
    'pdf.worker.mjs'
  )
  if (fsSync.existsSync(workerFile)) {
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerFile).href
  }
  return pdfjs
}

function inferFieldTypeFromLabel(label: string, hasOptions: boolean): FormFieldType {
  if (hasOptions) return 'select'
  const lower = label.toLowerCase()
  if (lower.includes('signature') || /\bsign\b/.test(lower)) return 'signature'
  if (lower.includes('email') || lower.includes('e-mail')) return 'email'
  if (lower.includes('phone') || lower.includes('mobile') || lower.includes('tel')) return 'phone'
  if (lower.includes('date') || lower.includes('dob') || lower.includes('birth')) return 'date'
  if (lower.includes('address')) return 'textarea'
  if (
    lower.includes('zip') ||
    lower.includes('pin code') ||
    lower.includes('pincode') ||
    lower.includes('postal code') ||
    lower.includes('amount') ||
    lower.includes('age') ||
    lower.includes('account number')
  ) {
    return 'number'
  }
  return 'text'
}

function isSensitiveLabel(label: string): boolean {
  const lower = label.toLowerCase()
  return [
    'date of birth',
    'dob',
    'birth',
    'signature',
    'aadhaar',
    'aadhar',
    'pan',
    'passport',
    'bank account',
    'account number',
    'ifsc',
    'emergency contact',
    'nominee',
  ].some((kw) => lower.includes(kw))
}

export function buildFieldSpecFromLabel(params: {
  fieldNumber: number
  fieldName: string
  section?: string | null
  fieldType?: FormFieldType
  options?: string[]
  required?: boolean
}): FormFieldSpec {
  const cleanName = params.fieldName.replace(/[:_]+$/, '').trim()
  const opts = params.options && params.options.length > 0 ? params.options : undefined
  const fType = params.fieldType || inferFieldTypeFromLabel(cleanName, Boolean(opts))
  const lower = cleanName.toLowerCase()

  let whatToEnter = `Enter your ${cleanName} accurately.`
  let example = `Sample ${cleanName}`
  if (fType === 'date') {
    whatToEnter = lower.includes('dd/mm/yyyy')
      ? 'Enter the date in DD/MM/YYYY format.'
      : 'Enter the full date (DD/MM/YYYY).'
    example = 'e.g., 15/08/1995'
  } else if (fType === 'email') {
    whatToEnter = 'Enter an active, valid email address.'
    example = 'e.g., name@example.com'
  } else if (fType === 'phone') {
    whatToEnter = 'Enter a reachable mobile or landline phone number with country/area code.'
    example = 'e.g., +91 98111 22334'
  } else if (fType === 'signature') {
    whatToEnter = 'Sign manually by hand after printing or when submitting in person.'
    example = 'Handwritten signature'
  } else if (opts) {
    whatToEnter = `Select one option: ${opts.join(', ')}.`
    example = `e.g., ${opts[0]}`
  } else if (lower.includes('first name')) {
    example = 'e.g., Rohan'
  } else if (lower.includes('last name') || lower.includes('surname')) {
    example = 'e.g., Verma'
  } else if (lower.includes('full name')) {
    example = 'e.g., Rohan Verma'
  } else if (lower.includes('address')) {
    example = 'e.g., 42 Sunrise Apartments, MG Road'
  } else if (lower.includes('city') || lower.includes('suburb')) {
    example = 'e.g., Bengaluru'
  } else if (lower.includes('state') || lower.includes('province')) {
    example = 'e.g., Karnataka'
  } else if (lower.includes('postal') || lower.includes('zip') || lower.includes('pin')) {
    example = 'e.g., 560038'
  } else if (lower.includes('country')) {
    example = 'e.g., India'
  }

  return {
    fieldNumber: params.fieldNumber,
    fieldName: cleanName,
    section: params.section || null,
    fieldType: fType,
    options: opts,
    required: params.required ?? !(lower.includes('middle') || lower.includes('alternative') || lower.includes('optional')),
    meaning: `Printed field "${cleanName}"${params.section ? ` under ${params.section}` : ''}.`,
    whatToEnter,
    example,
    isSensitive: isSensitiveLabel(cleanName),
    isUnreadable: false,
  }
}

function isSectionHeadingLine(line: string): boolean {
  const t = line.trim()
  if (/^\d+\.\s+[A-Z0-9\s/&()-]{3,50}$/.test(t)) return true
  if (/^(?:section|part)\s+[A-Z0-9]+[:\s.-]/i.test(t)) return true
  return false
}

function isBoilerplateLine(line: string): boolean {
  const t = line.trim()
  const lower = t.toLowerCase()
  if (!t || t.length < 2) return true
  if (/^page\s+\d+\s*(?:of\s*\d+)?$/i.test(lower)) return true
  if (/^(?:personal details form|application form|claim form|registration form)$/i.test(lower)) return true
  if (lower.startsWith('please complete') || lower.startsWith('please fill') || lower.startsWith('note:')) return true
  if (lower.startsWith('i hereby') || lower.startsWith('understand that') || lower.startsWith('record processing')) return true
  if (t.length > 72 && !t.includes('___') && !t.endsWith(':')) return true
  return false
}

const KNOWN_SHORT_OPTIONS = new Set(['male', 'female', 'other', 'yes', 'no', 'single', 'married', 'divorced', 'widowed', 'mr', 'mrs', 'ms'])

function attachOptionsToRecentField(out: FormFieldSpec[], optionTokens: string[]) {
  if (out.length === 0 || optionTokens.length === 0) return
  const joinedLower = optionTokens.join(' ').toLowerCase()
  const recent = out.slice(-4)
  let target: FormFieldSpec | undefined

  if (joinedLower.includes('male') || joinedLower.includes('female')) {
    target = recent.find((f) => /\b(gender|sex)\b/i.test(f.fieldName))
  } else if (joinedLower.includes('single') || joinedLower.includes('married')) {
    target = recent.find((f) => /\bmarital\b/i.test(f.fieldName))
  } else if (joinedLower.includes('mr') || joinedLower.includes('mrs')) {
    target = recent.find((f) => /\b(title|salutation)\b/i.test(f.fieldName))
  }

  target = target || out[out.length - 1]
  target.options = Array.from(new Set([...(target.options || []), ...optionTokens]))
  target.fieldType = 'select'
  target.whatToEnter = `Select one option: ${target.options.join(', ')}.`
  target.example = `e.g., ${target.options[0]}`
}

function extractCandidateFieldsFromLines(lines: string[], startNum: number): FormFieldSpec[] {
  const out: FormFieldSpec[] = []
  let currentSection: string | null = null
  let nextNum = startNum

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw) continue

    if (isSectionHeadingLine(raw)) {
      currentSection = raw
      continue
    }

    if (isBoilerplateLine(raw)) continue

    // Clean inline blank underscores/colons
    const cleaned = raw.replace(/_{2,}/g, '').replace(/\s+/g, ' ').trim()
    if (!cleaned) continue

    // Split multi-column lines separated by wide spacing or pipe
    const parts = cleaned.split(/\s*\|\s*|\s{3,}/).map((p) => p.trim()).filter(Boolean)

    // Detect checkbox option rows right under a single label like "Gender" -> ["Male", "Female", "Other"]
    if (parts.length === 1) {
      const single = parts[0].replace(/:$/, '').trim()
      const wordOpts = single.split(/[\s/]+/).map((w) => w.trim()).filter(Boolean)
      if (wordOpts.length >= 1 && wordOpts.every((w) => KNOWN_SHORT_OPTIONS.has(w.toLowerCase()))) {
        attachOptionsToRecentField(out, wordOpts)
        continue
      }

      // Look ahead if following lines are short option keywords (e.g. Male / Female / Other)
      const collectedOpts: string[] = []
      let look = i + 1
      while (look < lines.length) {
        const peek = lines[look].trim()
        const peekTokens = peek.split(/\s*\|\s*|\s+/).map((x) => x.trim()).filter(Boolean)
        if (peekTokens.length > 0 && peekTokens.every((tok) => KNOWN_SHORT_OPTIONS.has(tok.toLowerCase()))) {
          collectedOpts.push(...peekTokens)
          look++
        } else {
          break
        }
      }
      if (collectedOpts.length >= 2) {
        out.push(
          buildFieldSpecFromLabel({
            fieldNumber: nextNum++,
            fieldName: single,
            section: currentSection,
            options: collectedOpts,
          })
        )
        i = look - 1
        continue
      }

      if (single.length >= 2 && single.length <= 65) {
        out.push(
          buildFieldSpecFromLabel({
            fieldNumber: nextNum++,
            fieldName: single,
            section: currentSection,
          })
        )
      }
    } else {
      // Multiple tokens on the same horizontal row
      const allOptions = parts.every((p) =>
        p.split(/[\s/]+/).every((w) => KNOWN_SHORT_OPTIONS.has(w.toLowerCase()))
      )
      if (allOptions && out.length > 0) {
        attachOptionsToRecentField(
          out,
          parts.flatMap((p) => p.split(/[\s/]+/).filter(Boolean))
        )
        continue
      }

      for (const p of parts) {
        const cleanPart = p.replace(/:$/, '').trim()
        if (cleanPart.length >= 2 && cleanPart.length <= 65 && !isBoilerplateLine(cleanPart)) {
          out.push(
            buildFieldSpecFromLabel({
              fieldNumber: nextNum++,
              fieldName: cleanPart,
              section: currentSection,
            })
          )
        }
      }
    }
  }

  return out
}

/**
 * Inspects a PDF buffer for interactive AcroForm fields without mutating the document.
 */
export async function inspectPdfAcroForm(buffer: Buffer): Promise<PdfInspectionResult> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true })
    const form = doc.getForm()
    const rawFields = form.getFields()

    if (!rawFields || rawFields.length === 0) {
      return { isPdf: true, hasFillableFields: false, fields: [] }
    }

    const fields: AcroFormFieldSummary[] = rawFields.map((field) => {
      const name = field.getName()
      if (field instanceof PDFCheckBox) {
        return { name, type: 'checkbox' }
      }
      if (field instanceof PDFDropdown) {
        return { name, type: 'select', options: field.getOptions() }
      }
      if (field instanceof PDFRadioGroup) {
        return { name, type: 'select', options: field.getOptions() }
      }
      if (field instanceof PDFTextField) {
        return { name, type: 'text' }
      }
      return { name, type: 'unclear' }
    })

    return {
      isPdf: true,
      hasFillableFields: fields.length > 0,
      fields,
    }
  } catch {
    return { isPdf: false, hasFillableFields: false, fields: [] }
  }
}

/**
 * Extracts printed text, section layout, and candidate labels page-by-page from a PDF buffer.
 * Works on non-interactive PDFs (zero AcroForm fields) and detects image-only/scanned PDFs.
 */
export async function extractPdfPrintedText(buffer: Buffer): Promise<PdfTextExtractionResult> {
  try {
    const pdfjs = await loadPdfJs()
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      verbosity: 0,
    })
    const pdf = await loadingTask.promise
    const pageCount = pdf.numPages

    const pages: PdfPrintedPage[] = []
    let totalChars = 0
    let runningFieldNumber = 1

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const tc = await page.getTextContent()

      type TextEntry = { str: string; x: number; y: number; width: number }
      const entries: TextEntry[] = []
      for (const item of tc.items as any[]) {
        if (typeof item?.str === 'string' && item.str.trim()) {
          entries.push({
            str: item.str.trim(),
            x: Array.isArray(item.transform) ? Number(item.transform[4]) || 0 : 0,
            y: Array.isArray(item.transform) ? Number(item.transform[5]) || 0 : 0,
            width: Number(item.width) || 0,
          })
        }
      }

      // Group text spans onto horizontal lines sorted top-to-bottom, left-to-right
      entries.sort((a, b) => {
        if (Math.abs(b.y - a.y) > 4.5) return b.y - a.y
        return a.x - b.x
      })

      const rows: TextEntry[][] = []
      for (const ent of entries) {
        const lastRow = rows[rows.length - 1]
        if (lastRow && Math.abs(lastRow[0].y - ent.y) <= 4.5) {
          lastRow.push(ent)
        } else {
          rows.push([ent])
        }
      }

      const textLines = rows.map((row) => {
        row.sort((a, b) => a.x - b.x)
        let line = ''
        let prevEnd = -Infinity
        for (const token of row) {
          if (line) {
            const gap = token.x - prevEnd
            line += gap > 28 ? ' | ' : ' '
          }
          line += token.str
          prevEnd = token.x + token.width
        }
        return line.trim()
      })

      const fullText = textLines.join('\n')
      const charCount = fullText.replace(/\s+/g, '').length
      totalChars += charCount

      const candidateFields = extractCandidateFieldsFromLines(textLines, runningFieldNumber)
      runningFieldNumber += candidateFields.length

      pages.push({
        pageNumber: pageNum,
        textLines,
        fullText,
        charCount,
        candidateFields,
      })
    }

    const isLikelyScanned = pageCount > 0 && totalChars / pageCount < 60
    const allCandidates = pages.flatMap((p) => p.candidateFields)
    const combinedText = pages
      .map((p) => `--- PAGE ${p.pageNumber} ---\n${p.fullText}`)
      .join('\n\n')

    return {
      isPdf: true,
      pageCount,
      isLikelyScanned,
      totalChars,
      pages,
      combinedText,
      candidateFields: allCandidates,
    }
  } catch {
    return {
      isPdf: false,
      pageCount: 0,
      isLikelyScanned: false,
      totalChars: 0,
      pages: [],
      combinedText: '',
      candidateFields: [],
    }
  }
}

/**
 * Renders PDF pages as crisp PNG buffers for visual / OCR inspection via Gemini Vision.
 */
export async function renderPdfPagesToPng(
  buffer: Buffer,
  maxPages = 5,
  scale = 1.75
): Promise<PdfRenderedPageImage[]> {
  try {
    const pdfjs = await loadPdfJs()
    const { createCanvas } = await import('@napi-rs/canvas')

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      verbosity: 0,
    })
    const pdf = await loadingTask.promise
    const limit = Math.min(pdf.numPages, Math.max(1, maxPages))
    const images: PdfRenderedPageImage[] = []

    for (let pageNum = 1; pageNum <= limit; pageNum++) {
      const page = await pdf.getPage(pageNum)
      const viewport = page.getViewport({ scale })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      const canvas = createCanvas(width, height)
      const ctx = canvas.getContext('2d') as any

      // Fill white background so transparent PDFs stay crisp on dark/light OCR
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)

      await page.render({ canvas: canvas as any, canvasContext: ctx, viewport }).promise
      images.push({
        pageNumber: pageNum,
        pngBuffer: canvas.toBuffer('image/png'),
        width,
        height,
      })
    }

    return images
  } catch {
    return []
  }
}

/**
 * Merges and deduplicates form fields detected across multiple passes (AcroForm, Gemini PDF,
 * page-by-page Gemini Vision, and printed text), keeping richer descriptions & sequentially numbering.
 */
export function dedupeFormFields(fields: FormFieldSpec[]): FormFieldSpec[] {
  const merged = new Map<string, FormFieldSpec>()

  for (const field of fields) {
    const cleanName = (field.fieldName || '').trim()
    if (!cleanName) continue

    const sectionNorm = field.section ? normalizeKey(field.section) : ''
    const nameNorm = normalizeKey(cleanName)
    if (!nameNorm) continue

    // Disambiguate repeated labels in separate sections (e.g., "Email Address" under Contact vs Emergency Contact)
    const compositeKey = sectionNorm ? `${sectionNorm}::${nameNorm}` : nameNorm
    const looseMatchKey = !sectionNorm
      ? Array.from(merged.keys()).find((k) => k === nameNorm || k.endsWith(`::${nameNorm}`))
      : merged.has(nameNorm)
        ? nameNorm
        : undefined

    const targetKey = merged.has(compositeKey) ? compositeKey : looseMatchKey || compositeKey
    const existing = merged.get(targetKey)

    if (!existing) {
      merged.set(targetKey, { ...field, fieldName: cleanName })
    } else {
      // Keep the richer description/options without losing section context
      const existingGeneric = existing.meaning.startsWith('Printed field ') || existing.meaning.startsWith('Interactive PDF')
      const incomingGeneric = field.meaning.startsWith('Printed field ') || field.meaning.startsWith('Interactive PDF')
      merged.set(targetKey, {
        ...existing,
        section: existing.section || field.section || null,
        fieldType: existing.fieldType === 'text' && field.fieldType !== 'text' ? field.fieldType : existing.fieldType,
        options:
          existing.options && existing.options.length > 0
            ? Array.from(new Set([...existing.options, ...(field.options || [])]))
            : field.options,
        meaning: existingGeneric && !incomingGeneric ? field.meaning : existing.meaning,
        whatToEnter: existingGeneric && !incomingGeneric ? field.whatToEnter : existing.whatToEnter,
        example: existing.example === 'N/A' || existing.example.startsWith('Sample ') ? field.example : existing.example,
        isSensitive: Boolean(existing.isSensitive || field.isSensitive),
        isUnreadable: Boolean(existing.isUnreadable && field.isUnreadable),
      })
    }
  }

  return Array.from(merged.values()).map((f, idx) => ({
    ...f,
    fieldNumber: idx + 1,
  }))
}

/**
 * Safely fills interactive AcroForm fields matching the confirmed user answers.
 * Never guesses arbitrary pixel coordinates on flat scanned PDFs.
 */
export async function fillPdfAcroForm(
  buffer: Buffer,
  answersByFieldName: Record<string, string>
): Promise<{ fillable: boolean; filledCount: number; pdfBytes?: Uint8Array }> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true })
    const form = doc.getForm()
    const fields = form.getFields()
    if (!fields || fields.length === 0) {
      return { fillable: false, filledCount: 0 }
    }

    const normalizedAnswers = new Map<string, string>()
    for (const [label, val] of Object.entries(answersByFieldName)) {
      if (typeof val === 'string' && val.trim()) {
        const key = normalizeKey(label)
        if (key) normalizedAnswers.set(key, val.trim())
      }
    }

    let filledCount = 0
    for (const field of fields) {
      const pdfName = field.getName()
      const normPdf = normalizeKey(pdfName)

      let matchedValue = normalizedAnswers.get(normPdf)
      if (!matchedValue) {
        for (const [k, v] of normalizedAnswers.entries()) {
          if ((normPdf.length >= 4 && k.includes(normPdf)) || (k.length >= 4 && normPdf.includes(k))) {
            matchedValue = v
            break
          }
        }
      }

      if (!matchedValue) continue

      try {
        if (field instanceof PDFTextField) {
          field.setText(matchedValue)
          filledCount++
        } else if (field instanceof PDFCheckBox) {
          if (/^(true|yes|1|checked|on|agree|accept)$/i.test(matchedValue)) {
            field.check()
          } else {
            field.uncheck()
          }
          filledCount++
        } else if (field instanceof PDFDropdown || field instanceof PDFRadioGroup) {
          const opts = field.getOptions()
          const optMatch = opts.find((o) => normalizeKey(o) === normalizeKey(matchedValue!))
          if (optMatch) {
            field.select(optMatch)
            filledCount++
          }
        }
      } catch {
        // Skip incompatible field cleanly
      }
    }

    const pdfBytes = await doc.save()
    return {
      fillable: true,
      filledCount,
      pdfBytes,
    }
  } catch {
    return { fillable: false, filledCount: 0 }
  }
}
