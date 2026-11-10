import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import {
  dedupeFormFields,
  extractPdfPrintedText,
  fillPdfAcroForm,
  inspectPdfAcroForm,
  renderPdfPagesToPng,
} from '../lib/lifefile/pdf-form.ts'
import { extractDocumentWithGemini, hasFormSignals } from '../lib/lifefile/gemini-extractor.ts'
import {
  analyzeFormPrefills,
  looksLikeFormDocument,
  processFormIntelligence,
} from '../lib/lifefile/form-assistant.ts'
import { needsFormFieldRecovery, recoverFormAnalysisForDocument } from '../lib/lifefile/form-recovery.ts'
import { saveDocument, updateDocument } from '../lib/lifefile/storage.ts'
import { getReasoningReply } from '../lib/ai/reasoning-orchestrator.ts'

const TEST_USER_ID = 'usr_1700000099_aabbccddeeff'
const TEST_PROFILE = { name: 'Aarav Sharma', email: 'aarav.sharma@example.com', phone: null }

function pass(name: string) {
  console.log(`PASS: ${name}`)
}

async function createBlankPersonalDetailsPdfFixture(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595, 842])
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const lines: Array<{ text: string; x: number; y: number; size?: number; isBold?: boolean }> = [
    { text: 'PERSONAL DETAILS FORM', x: 50, y: 790, size: 16, isBold: true },
    { text: 'Please complete this form in clearly written block letters or type before printing.', x: 50, y: 770, size: 9 },
    { text: '1. GENERAL INFORMATION', x: 50, y: 740, size: 11, isBold: true },
    { text: 'First Name', x: 50, y: 718 },
    { text: 'Middle Name(s)', x: 230, y: 718 },
    { text: 'Last Name / Surname', x: 400, y: 718 },
    { text: 'Date of Birth (DD/MM/YYYY)', x: 50, y: 678 },
    { text: 'Marital Status', x: 320, y: 678 },
    { text: 'Gender', x: 50, y: 642 },
    { text: 'Male', x: 50, y: 626 },
    { text: 'Female', x: 110, y: 626 },
    { text: 'Other', x: 175, y: 626 },
    { text: '2. CONTACT DETAILS', x: 50, y: 590, size: 11, isBold: true },
    { text: 'Primary Phone Number', x: 50, y: 568 },
    { text: 'Alternative Phone Number', x: 300, y: 568 },
    { text: 'Email Address', x: 50, y: 532 },
    { text: '3. RESIDENTIAL ADDRESS', x: 50, y: 492, size: 11, isBold: true },
    { text: 'Street Address (Unit, Building, Street)', x: 50, y: 470 },
    { text: 'City / Suburb', x: 50, y: 432 },
    { text: 'State / Province', x: 230, y: 432 },
    { text: 'Postal / Zip Code', x: 400, y: 432 },
    { text: 'Country', x: 50, y: 396 },
    { text: '4. EMERGENCY CONTACT', x: 50, y: 356, size: 11, isBold: true },
    { text: 'Full Name', x: 50, y: 334 },
    { text: 'Relationship', x: 300, y: 334 },
    { text: 'Phone Number', x: 50, y: 298 },
    { text: 'Email Address', x: 300, y: 298 },
    {
      text: 'I hereby declare that the information provided above is true, accurate, and complete.',
      x: 50,
      y: 250,
      size: 9,
    },
    { text: "Applicant's Signature", x: 50, y: 205 },
    { text: 'Date', x: 380, y: 205 },
  ]

  for (const item of lines) {
    page.drawText(item.text, {
      x: item.x,
      y: item.y,
      size: item.size || 10,
      font: item.isBold ? bold : font,
      color: rgb(0.1, 0.1, 0.1),
    })
  }

  return Buffer.from(await pdfDoc.save())
}

async function createScannedPdfSample(): Promise<Buffer> {
  const canvas = createCanvas(800, 1000)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 800, 1000)
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 28px sans-serif'
  ctx.fillText('SCANNED KYC APPLICATION FORM', 60, 80)
  ctx.font = '20px sans-serif'
  ctx.fillText('1. Applicant Full Name: ___________________________', 60, 170)
  ctx.fillText('2. Date of Birth (DD/MM/YYYY): ____________________', 60, 240)
  ctx.fillText('3. Mobile Number: _________________________________', 60, 310)
  ctx.fillText('4. Permanent Address: _____________________________', 60, 380)
  ctx.fillText('5. Applicant Signature: ___________________________', 60, 460)
  const pngBuf = canvas.toBuffer('image/png')

  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([595, 842])
  const embedded = await pdfDoc.embedPng(pngBuf)
  page.drawImage(embedded, { x: 20, y: 80, width: 555, height: 690 })
  return Buffer.from(await pdfDoc.save())
}

async function createInteractivePdfSample(): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([550, 700])
  const form = pdfDoc.getForm()
  form.createTextField('Full Name').addToPage(page, { x: 40, y: 600, width: 220, height: 22 })
  form.createTextField('Date of Birth').addToPage(page, { x: 40, y: 550, width: 220, height: 22 })
  form.createCheckBox('Agree Terms').addToPage(page, { x: 40, y: 500, width: 16, height: 16 })
  return Buffer.from(await pdfDoc.save())
}

async function main() {
  console.log('=== Blank / Printed / Scanned PDF Form Detection Test Suite ===')

  const testUserRoot = path.join(process.cwd(), 'data', 'users', TEST_USER_ID)
  try {
    const personalBuf = await createBlankPersonalDetailsPdfFixture()

    // 1. Inspect AcroForm (0 fields) + Printed Text + Render PNG on blank Personal Details Form PDF
    const acro = await inspectPdfAcroForm(personalBuf)
    assert.strictEqual(acro.isPdf, true)
    assert.strictEqual(acro.hasFillableFields, false, 'Blank Personal Details Form has no interactive widgets')

    const printed = await extractPdfPrintedText(personalBuf)
    assert.strictEqual(printed.isPdf, true)
    assert.strictEqual(printed.pageCount, 1)
    assert.strictEqual(printed.isLikelyScanned, false)
    assert.ok(printed.totalChars > 400, `Expected full printed text, got ${printed.totalChars} chars`)
    assert.ok(printed.combinedText.includes('First Name'))
    assert.ok(printed.combinedText.includes('Date of Birth (DD/MM/YYYY)'))
    assert.ok(printed.combinedText.includes('RESIDENTIAL ADDRESS'))
    assert.ok(printed.combinedText.includes('EMERGENCY CONTACT'))
    assert.ok(
      printed.candidateFields.length >= 16,
      `Expected >=16 candidate printed fields, got ${printed.candidateFields.length}`
    )

    const genderField = printed.candidateFields.find((f) => f.fieldName.toLowerCase().includes('gender'))
    assert.ok(
      genderField && genderField.options && genderField.options.length >= 3,
      'Gender checkbox/radio options must be captured'
    )
    assert.ok(
      hasFormSignals({
        printedText: printed,
        hasAcroFields: acro.hasFillableFields,
        filenameOrTitle: 'Personal Details Form.pdf',
      }),
      'hasFormSignals must detect blank Personal Details Form'
    )

    const pngPages = await renderPdfPagesToPng(personalBuf, 2, 1.5)
    assert.strictEqual(pngPages.length, 1)
    assert.ok(pngPages[0].pngBuffer.length > 20000, 'Rendered PNG should contain rich visual page bytes')
    pass('Test 1: Blank Personal Details Form (0 AcroForm fields) detected via printed text, layout & PNG render (>=16 fields + Gender options)')

    // 2. Deduplication check across multiple methods
    const deduped = dedupeFormFields([...printed.candidateFields, ...printed.candidateFields])
    assert.strictEqual(deduped.length, printed.candidateFields.length, 'Deduplication must remove duplicate labels')
    // Email Address appears in Contact Details AND Emergency Contact — both preserved with section differentiation!
    const emailFields = deduped.filter((f) => f.fieldName.toLowerCase().includes('email address'))
    assert.strictEqual(emailFields.length, 2, 'Email Address in separate sections must both be preserved cleanly')
    pass('Test 2: Multi-pass deduplication removes identical duplicates while keeping distinct sections')

    // 3. Recovery from stripped Guided Upload metadata using an isolated temporary test user
    const savedDoc = await saveDocument(personalBuf, 'Personal Details Form.pdf', 'application/pdf', TEST_USER_ID)
    const strippedDoc = await updateDocument(
      savedDoc.id,
      {
        extractionStatus: 'completed',
        extractedData: {
          documentType: 'Other',
          documentKind: 'other',
          isForm: false,
          documentTitle: 'PERSONAL DETAILS FORM',
          userCategory: 'Identity / Personal Documents',
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
          supportingDetails: null,
          formAnalysis: null,
          summary:
            'This is a blank personal details form requesting general information, contact details, residential address, emergency contact information, and an applicant signature.',
        },
      },
      TEST_USER_ID
    )
    assert.ok(strippedDoc)
    assert.strictEqual(looksLikeFormDocument(strippedDoc), true)
    assert.strictEqual(needsFormFieldRecovery(strippedDoc), true)

    const recoveredDoc = await recoverFormAnalysisForDocument(strippedDoc, TEST_USER_ID)
    assert.strictEqual(recoveredDoc.extractedData?.isForm, true)
    assert.ok(
      (recoveredDoc.extractedData?.formAnalysis?.fields?.length || 0) >= 16,
      'Recovered formAnalysis must contain all printed fields'
    )

    const formGuideState = analyzeFormPrefills({
      formDoc: recoveredDoc,
      documents: [recoveredDoc],
      userProfile: TEST_PROFILE,
    })
    assert.ok(formGuideState.fields.length >= 16)
    assert.strictEqual(
      formGuideState.fields.find((f) => f.fieldName === 'Email Address')?.prefilledValue,
      TEST_PROFILE.email
    )

    const intelEn = processFormIntelligence({
      query: 'What should I fill in Personal Details Form.pdf?',
      documents: [recoveredDoc],
      userProfile: TEST_PROFILE,
    })
    assert.strictEqual(intelEn.isFormQuery, true)
    assert.ok(intelEn.groundedFormContext.includes('RESPONSE STYLE TIP: Start cleanly with "I found'))
    assert.ok(intelEn.groundedFormContext.includes('Date of Birth'))

    const intelHi = processFormIntelligence({
      query: 'Personal Details Form.pdf mein kya bharna hai?',
      documents: [recoveredDoc],
      userProfile: TEST_PROFILE,
    })
    assert.strictEqual(intelHi.isFormQuery, true)
    assert.strictEqual(intelHi.targetFormDoc?.id, strippedDoc.id)
    pass('Test 3: Blank Personal Details Form recovered cleanly with English & Hinglish guidance')

    // 4. Scanned / Image-Only PDF Detection & Page-to-PNG Rendering
    const scannedBuf = await createScannedPdfSample()
    const scannedAcro = await inspectPdfAcroForm(scannedBuf)
    assert.strictEqual(scannedAcro.hasFillableFields, false)
    const scannedText = await extractPdfPrintedText(scannedBuf)
    assert.strictEqual(scannedText.isPdf, true)
    assert.strictEqual(scannedText.isLikelyScanned, true, 'Image-only PDF must be flagged isLikelyScanned=true')
    assert.strictEqual(scannedText.totalChars, 0)
    const scannedImgs = await renderPdfPagesToPng(scannedBuf, 3, 1.75)
    assert.strictEqual(scannedImgs.length, 1)
    assert.ok(scannedImgs[0].pngBuffer.length > 5000, 'Scanned PDF must render cleanly to PNG for OCR/vision')
    pass('Test 4: Scanned image-only PDF accurately flagged & rendered to crisp PNG for visual OCR')

    // 5. Interactive AcroForm PDF still works cleanly
    const interactiveBuf = await createInteractivePdfSample()
    const interactiveAcro = await inspectPdfAcroForm(interactiveBuf)
    assert.strictEqual(interactiveAcro.hasFillableFields, true)
    assert.strictEqual(interactiveAcro.fields.length, 3)
    const filled = await fillPdfAcroForm(interactiveBuf, {
      'Full Name': TEST_PROFILE.name,
      'Date of Birth': '15/08/1998',
      'Agree Terms': 'Yes',
    })
    assert.strictEqual(filled.fillable, true)
    assert.strictEqual(filled.filledCount, 3)
    pass('Test 5: Interactive AcroForm detection and filling intact')

    // 6. Optional Live Gemini Verification (when GEMINI_API_KEY is loaded & network permitted)
    if (process.env.GEMINI_API_KEY) {
      const liveBlank = await extractDocumentWithGemini(personalBuf, 'application/pdf', 'Identity / Personal Documents')
      assert.strictEqual(liveBlank.success, true, `Live Personal Details extraction error: ${liveBlank.error}`)
      assert.strictEqual(liveBlank.data?.isForm, true, 'Live Gemini must classify Personal Details Form.pdf as form')
      assert.ok(
        (liveBlank.data?.formAnalysis?.fields?.length || 0) >= 18,
        `Live Personal Details Form must detect >=18 printed fields, got ${liveBlank.data?.formAnalysis?.fields?.length}`
      )

      const liveScanned = await extractDocumentWithGemini(scannedBuf, 'application/pdf')
      assert.strictEqual(liveScanned.success, true, `Live scanned PDF extraction error: ${liveScanned.error}`)
      assert.strictEqual(liveScanned.data?.isForm, true, 'Live Gemini visual OCR must classify scanned PDF as form')
      assert.ok(
        (liveScanned.data?.formAnalysis?.fields?.length || 0) >= 4,
        `Live scanned PDF must detect printed visual fields, got ${liveScanned.data?.formAnalysis?.fields?.length}`
      )

      const liveChat = await getReasoningReply({
        messages: [{ role: 'user', content: 'Personal Details Form.pdf mein kya bharna hai?' }],
        documentsOverride: [recoveredDoc],
        tasksOverride: [],
        productsOverride: [],
        contactsOverride: [],
        memoriesOverride: [],
        userProfileOverride: TEST_PROFILE,
      })
      assert.strictEqual(liveChat.success, true)
      assert.ok(!liveChat.reply.toLowerCase().includes('koi specific fillable fields mention nahi'), 'Must NEVER say no fields mentioned')
      assert.ok(liveChat.reply.toLowerCase().includes('first name') || liveChat.reply.toLowerCase().includes('date of birth'))
      pass('Test 6: Live Gemini Scanned PDF Visual OCR + Hinglish Conversational Form Guide verified')
    } else {
      console.log('INFO: GEMINI_API_KEY not loaded in env — skipped optional live Gemini OCR/chat assertion.')
    }

    console.log('ALL BLANK/SCANNED/INTERACTIVE PDF DETECTION TESTS PASSED!')
  } finally {
    fs.rmSync(testUserRoot, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('TEST FAILED:', err)
  process.exit(1)
})
