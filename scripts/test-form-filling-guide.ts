import assert from 'node:assert'
import { PDFDocument } from 'pdf-lib'
import { sanitizeExtractedJson } from '../lib/lifefile/gemini-extractor.ts'
import { mergeExtractedMetadata } from '../lib/lifefile/metadata-sanitize.ts'
import { inspectPdfAcroForm, fillPdfAcroForm } from '../lib/lifefile/pdf-form.ts'
import {
  analyzeFormPrefills,
  formatAnswerSheetText,
  processFormIntelligence,
} from '../lib/lifefile/form-assistant.ts'
import { searchLifeFile } from '../lib/lifefile/retrieval.ts'
import { getReasoningReply } from '../lib/ai/reasoning-orchestrator.ts'
import type { StoredDocument } from '../lib/lifefile/types.ts'
import type { StoredProduct } from '../lib/products/types.ts'
import type { StoredMemory } from '../lib/memory/types.ts'

function pass(name: string) {
  console.log(`PASS: ${name}`)
}

function makeDoc(
  id: string,
  filename: string,
  mimeType: string,
  extractedData: StoredDocument['extractedData']
): StoredDocument {
  return {
    id,
    originalFilename: filename,
    storageFilename: `${id}.${mimeType === 'application/pdf' ? 'pdf' : 'png'}`,
    mimeType,
    fileSize: 2048,
    uploadTimestamp: '2026-11-10T10:00:00.000Z',
    extractionStatus: 'completed',
    extractedData,
    extractionError: null,
  }
}

async function runTests() {
  console.log('=== AI Form Filling Guide Test Suite ===')

  // 1. Test sanitizeExtractedJson for all 5 document types (4 forms + 1 supporting record)
  const rawClaimFormJson = JSON.stringify({
    documentType: 'Insurance',
    documentKind: 'claim_form',
    isForm: true,
    documentTitle: 'HDFC Ergo Health Insurance Reimbursement Claim Form',
    issuer: 'HDFC Ergo',
    customerName: null,
    summary: 'Blank health insurance claim form with 6 sections/fields.',
    formAnalysis: {
      isForm: true,
      documentKind: 'claim_form',
      formTitle: 'HDFC Ergo Reimbursement Claim Form',
      formPurpose: 'Submit medical expenses for health insurance reimbursement.',
      whoShouldFill: 'Policyholder / Insured Member',
      requiredDocuments: ['Insurance Policy Copy', 'Hospital Discharge Summary', 'Original Medical Bills'],
      instructions: ['Fill in BLOCK LETTERS', 'Attach cancelled cheque for NEFT'],
      fields: [
        {
          fieldNumber: 1,
          fieldName: 'Policyholder Full Name',
          section: 'Section A - Insured Details',
          fieldType: 'text',
          required: true,
          meaning: 'Legal name of the primary insurance holder.',
          whatToEnter: 'Your full name exactly as printed on your health policy.',
          example: 'e.g., Rahul Sharma',
          isSensitive: false,
          isUnreadable: false,
        },
        {
          fieldNumber: 2,
          fieldName: 'Policy Number',
          section: 'Section A - Insured Details',
          fieldType: 'text',
          required: true,
          meaning: 'Unique health insurance policy identifier.',
          whatToEnter: 'Enter the alphanumeric policy number from your policy schedule.',
          example: 'e.g., HDFC-2026-998811',
          isSensitive: false,
          isUnreadable: false,
        },
        {
          fieldNumber: 3,
          fieldName: 'Hospital Address',
          section: 'Section B - Hospitalization',
          fieldType: 'textarea',
          required: true,
          meaning: 'Address of the hospital where treatment took place.',
          whatToEnter: 'Full street address and city of the hospital.',
          example: 'e.g., Lilavati Hospital, Bandra West, Mumbai',
          isSensitive: false,
          isUnreadable: false,
        },
        {
          fieldNumber: 4,
          fieldName: 'Bank Account Number',
          section: 'Section C - NEFT Payout',
          fieldType: 'number',
          required: true,
          meaning: 'Account where reimbursement money should be transferred.',
          whatToEnter: 'Enter your active savings bank account number.',
          example: 'e.g., 50100012345678',
          isSensitive: true,
          isUnreadable: false,
        },
        {
          fieldNumber: 5,
          fieldName: 'Blurry Field Box 5',
          section: 'Section C - NEFT Payout',
          fieldType: 'unclear',
          required: false,
          meaning: 'Portion of the scanned box label was faint/cropped.',
          whatToEnter: 'Check the original paper copy before filling this box.',
          example: 'e.g., Verify on original form',
          isSensitive: false,
          isUnreadable: true,
        },
        {
          fieldNumber: 6,
          fieldName: 'Claimant Signature',
          section: 'Declaration',
          fieldType: 'signature',
          required: true,
          meaning: 'Your handwritten signature authorizing the claim.',
          whatToEnter: 'Sign manually with pen after printing or on submission.',
          example: 'Handwritten signature matching KYC',
          isSensitive: true,
          isUnreadable: false,
        },
      ],
    },
  })

  const parsedClaim = sanitizeExtractedJson(rawClaimFormJson)
  assert.strictEqual(parsedClaim.isForm, true)
  assert.strictEqual(parsedClaim.documentKind, 'claim_form')
  assert.strictEqual(parsedClaim.formAnalysis?.fields.length, 6)
  assert.strictEqual(parsedClaim.formAnalysis?.fields[4].isUnreadable, true)
  pass('Scenario 1a: Blank insurance claim form parsed & classified cleanly')

  // Supporting document (Insurance Policy + Address Proof) - NOT a form!
  const supportingPolicyJson = sanitizeExtractedJson(
    JSON.stringify({
      documentType: 'Insurance',
      documentKind: 'insurance_document',
      isForm: false,
      documentTitle: 'HDFC Ergo Optima Secure Policy Schedule',
      issuer: 'HDFC Ergo',
      customerName: 'Rohan Verma',
      policyNumber: 'POL-88776655',
      expiryDate: '2027-03-31',
      supportingDetails: {
        address: '42 Sunrise Apartments, Indiranagar, Bengaluru 560038',
        bankAccountNumber: '998877665544',
        ifscCode: 'HDFC0001234',
        phone: '+91 9811122233',
      },
      summary: 'Active health insurance policy certificate for Rohan Verma.',
    })
  )
  assert.strictEqual(supportingPolicyJson.isForm, false)
  assert.strictEqual(supportingPolicyJson.documentKind, 'insurance_document')
  assert.strictEqual(supportingPolicyJson.supportingDetails?.address, '42 Sunrise Apartments, Indiranagar, Bengaluru 560038')
  pass('Scenario 5a: Supporting insurance policy classified isForm=false with supportingDetails')

  const claimFormDoc = makeDoc('doc_1700000001_aaaa1111', 'hdfc-claim-form.pdf', 'application/pdf', parsedClaim)
  const policyDoc = makeDoc('doc_1700000002_bbbb2222', 'hdfc-policy-schedule.pdf', 'application/pdf', supportingPolicyJson)

  const userProfile = {
    name: 'Rohan Verma',
    email: 'rohan.verma@example.in',
    phone: '+91 9811122233',
  }

  const unapprovedMem: StoredMemory = {
    id: 'mem_1',
    content: 'My bank account number is 000000000000',
    category: 'other',
    approvedByUser: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  }
  const approvedMem: StoredMemory = {
    id: 'mem_2',
    content: 'My home address is 42 Sunrise Apartments, Indiranagar, Bengaluru 560038',
    category: 'home',
    approvedByUser: true,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  }

  // Run analyzeFormPrefills on Scenario 1
  const claimState = analyzeFormPrefills({
    formDoc: claimFormDoc,
    documents: [claimFormDoc, policyDoc],
    memories: [unapprovedMem, approvedMem],
    userProfile,
  })

  assert.strictEqual(claimState.isForm, true)
  const fName = claimState.fields.find((f) => f.fieldNumber === 1)!
  assert.strictEqual(fName.status, 'available')
  assert.strictEqual(fName.prefilledValue, 'Rohan Verma')

  const fPolicy = claimState.fields.find((f) => f.fieldNumber === 2)!
  assert.strictEqual(fPolicy.status, 'available')
  assert.strictEqual(fPolicy.prefilledValue, 'POL-88776655')
  assert.strictEqual(fPolicy.sourceDocumentId, policyDoc.id)

  // Hospital Address should NOT silently auto-fill claimant's residential address (nonSelfPerson = hospital!)
  const fHospAddr = claimState.fields.find((f) => f.fieldNumber === 3)!
  assert.strictEqual(fHospAddr.status, 'needs_input')
  assert.strictEqual(fHospAddr.prefilledValue, null)

  // Bank Account Number is SENSITIVE: matched from policyDoc supportingDetails, MUST be 'needs_confirmation' (never silently available) AND must NEVER pick unapprovedMem!
  const fBank = claimState.fields.find((f) => f.fieldNumber === 4)!
  assert.strictEqual(fBank.isSensitive, true)
  assert.strictEqual(fBank.status, 'needs_confirmation')
  assert.strictEqual(fBank.prefilledValue, '998877665544')
  assert.strictEqual(fBank.needsUserConfirmation, true)

  // Unreadable field stays unclear
  const fBlurry = claimState.fields.find((f) => f.fieldNumber === 5)!
  assert.strictEqual(fBlurry.status, 'unclear')
  assert.strictEqual(fBlurry.prefilledValue, null)

  // Signature stays needs_input
  const fSign = claimState.fields.find((f) => f.fieldNumber === 6)!
  assert.strictEqual(fSign.status, 'needs_input')
  assert.strictEqual(fSign.prefilledValue, null)

  // Required Documents checklist checks LifeFile docs
  const policyReq = claimState.requiredDocuments.find((d) => d.name.includes('Policy Copy'))!
  assert.strictEqual(policyReq.foundInLifeFile, true)
  const dischargeReq = claimState.requiredDocuments.find((d) => d.name.includes('Discharge Summary'))!
  assert.strictEqual(dischargeReq.foundInLifeFile, false)
  pass('Scenario 1b: Insurance claim prefills, sensitive confirmation guard, blurry guard, non-self guard, supporting doc checklist')

  // 2. Conversational Queries (English + Hindi) on Scenario 1
  const q1 = processFormIntelligence({
    query: 'What should I fill in this form?',
    documents: [claimFormDoc, policyDoc],
    memories: [unapprovedMem, approvedMem],
    userProfile,
  })
  assert.strictEqual(q1.isFormQuery, true)
  assert.strictEqual(q1.asksAllFields, true)
  assert.strictEqual(q1.targetFormDoc?.id, claimFormDoc.id)
  assert.ok(q1.groundedFormContext.includes('Policyholder Full Name'))
  assert.ok(q1.groundedFormContext.includes('POL-88776655'))
  assert.ok(q1.formSources.some((s) => s.documentId === policyDoc.id))

  const q2 = processFormIntelligence({
    query: 'Explain field number 4.',
    documents: [claimFormDoc, policyDoc],
    userProfile,
  })
  assert.strictEqual(q2.requestedFieldNumber, 4)
  assert.ok(q2.groundedFormContext.includes('Requested Field #4 Details'))
  assert.ok(q2.groundedFormContext.includes('Bank Account Number'))
  assert.ok(!q2.groundedFormContext.includes('Field 1: "Policyholder Full Name"'))

  const qHindi = processFormIntelligence({
    query: 'इस फॉर्म में क्या भरना है? और कौनसे दस्तावेज़ चाहिए?',
    documents: [claimFormDoc, policyDoc],
    userProfile,
  })
  assert.strictEqual(qHindi.isFormQuery, true)
  assert.strictEqual(qHindi.targetFormDoc?.id, claimFormDoc.id)
  pass('Scenario 1c: Conversational form queries (What to fill, Field #4, Hindi/Devanagari) grounded with sources')

  // 3. Scenario 2: Bank Account Opening Form + Real AcroForm PDF Inspection & Filling
  const pdfDoc = await PDFDocument.create()
  const page = pdfDoc.addPage([600, 750])
  const acro = pdfDoc.getForm()
  const tfName = acro.createTextField('Full Name')
  tfName.addToPage(page, { x: 50, y: 650, width: 250, height: 24 })
  const tfEmail = acro.createTextField('Email Address')
  tfEmail.addToPage(page, { x: 50, y: 600, width: 250, height: 24 })
  const cbAlerts = acro.createCheckBox('SMS Alerts')
  cbAlerts.addToPage(page, { x: 50, y: 550, width: 16, height: 16 })
  const fillablePdfBuffer = Buffer.from(await pdfDoc.save())

  const inspectResult = await inspectPdfAcroForm(fillablePdfBuffer)
  assert.strictEqual(inspectResult.isPdf, true)
  assert.strictEqual(inspectResult.hasFillableFields, true)
  assert.strictEqual(inspectResult.fields.length, 3)

  const fillResult = await fillPdfAcroForm(fillablePdfBuffer, {
    'Full Name': 'Rohan Verma',
    'Email Address': 'rohan.verma@example.in',
    'SMS Alerts': 'Yes',
  })
  assert.strictEqual(fillResult.fillable, true)
  assert.strictEqual(fillResult.filledCount, 3)
  assert.ok(fillResult.pdfBytes && fillResult.pdfBytes.byteLength > 100)

  const reloadedPdf = await PDFDocument.load(fillResult.pdfBytes!)
  assert.strictEqual(reloadedPdf.getForm().getTextField('Full Name').getText(), 'Rohan Verma')
  assert.strictEqual(reloadedPdf.getForm().getTextField('Email Address').getText(), 'rohan.verma@example.in')
  assert.strictEqual(reloadedPdf.getForm().getCheckBox('SMS Alerts').isChecked(), true)

  // Also test flat (non-AcroForm) PDF fallback safety
  const flatPdf = await PDFDocument.create()
  flatPdf.addPage([400, 400])
  const flatBuffer = Buffer.from(await flatPdf.save())
  const flatInspect = await inspectPdfAcroForm(flatBuffer)
  assert.strictEqual(flatInspect.isPdf, true)
  assert.strictEqual(flatInspect.hasFillableFields, false)
  const flatFill = await fillPdfAcroForm(flatBuffer, { 'Full Name': 'Rohan Verma' })
  assert.strictEqual(flatFill.fillable, false)
  assert.strictEqual(flatFill.filledCount, 0)
  pass('Scenario 2: Bank Account Opening AcroForm PDF real fill + flat/non-fillable PDF safe fallback')

  // 4. Scenario 3: Electricity Connection Application + Supporting Utility Address Proof
  const elecAppForm = makeDoc(
    'doc_1700000003_cccc3333',
    'bescom-new-connection-form.pdf',
    'application/pdf',
    sanitizeExtractedJson(
      JSON.stringify({
        documentType: 'Bill',
        documentKind: 'application_form',
        isForm: true,
        documentTitle: 'Electricity Connection Transfer & Load Application',
        issuer: 'BESCOM',
        formAnalysis: {
          isForm: true,
          documentKind: 'application_form',
          formTitle: 'BESCOM Electricity Connection Form',
          formPurpose: 'Apply for a new domestic electricity meter or name transfer.',
          whoShouldFill: 'Property owner or tenant',
          requiredDocuments: ['Previous Electricity Bill', 'Address Proof'],
          fields: [
            {
              fieldNumber: 1,
              fieldName: 'Applicant Full Name',
              fieldType: 'text',
              required: true,
              meaning: 'Name on electricity account.',
              whatToEnter: 'Enter legal full name.',
              example: 'e.g., Rohan Verma',
            },
            {
              fieldNumber: 2,
              fieldName: 'Installation Address',
              fieldType: 'textarea',
              required: true,
              meaning: 'Premises address where supply is required.',
              whatToEnter: 'Complete flat/house number, street, city, PIN code.',
              example: 'e.g., Flat 101, MG Road, Bengaluru',
            },
            {
              fieldNumber: 3,
              fieldName: 'Existing Consumer Number',
              fieldType: 'text',
              required: false,
              meaning: 'Current CA / Consumer ID if modifying an existing connection.',
              whatToEnter: 'Enter 10-digit consumer number from old bill.',
              example: 'e.g., 1020304050',
            },
            {
              fieldNumber: 4,
              fieldName: 'Nominee Name',
              fieldType: 'text',
              required: false,
              meaning: 'Optional secondary nominee for the meter connection.',
              whatToEnter: 'Full name of family nominee if applicable.',
              example: 'e.g., Meera Verma',
            },
          ],
        },
      })
    )
  )

  const prevBillDoc = makeDoc(
    'doc_1700000004_dddd4444',
    'old-bescom-bill.pdf',
    'application/pdf',
    sanitizeExtractedJson(
      JSON.stringify({
        documentType: 'Bill',
        documentKind: 'bill',
        isForm: false,
        issuer: 'BESCOM',
        customerName: 'Rohan Verma',
        supportingDetails: {
          address: '42 Sunrise Apartments, Indiranagar, Bengaluru 560038',
          consumerNo: 'CA-77441122',
        },
      })
    )
  )

  const elecState = analyzeFormPrefills({
    formDoc: elecAppForm,
    documents: [elecAppForm, prevBillDoc],
    userProfile,
  })
  assert.strictEqual(elecState.fields[1].prefilledValue, '42 Sunrise Apartments, Indiranagar, Bengaluru 560038')
  assert.strictEqual(elecState.fields[2].prefilledValue, 'CA-77441122')
  // Nominee Name must NOT be auto-filled with Rohan Verma!
  assert.strictEqual(elecState.fields[3].prefilledValue, null)
  assert.strictEqual(elecState.requiredDocuments[0].foundInLifeFile, true)

  const qAddress = processFormIntelligence({
    query: 'Can you find my address from my documents?',
    documents: [elecAppForm, prevBillDoc],
    userProfile,
  })
  assert.strictEqual(qAddress.isFormQuery, true)
  assert.ok(qAddress.groundedFormContext.includes('42 Sunrise Apartments'))
  pass('Scenario 3: Electricity connection application prefills address & consumer number while guarding Nominee field')

  // 5. Scenario 4: Product Warranty Registration Form + Saved Product
  const warrantyForm = makeDoc(
    'doc_1700000005_eeee5555',
    'lg-warranty-registration.png',
    'image/png',
    sanitizeExtractedJson(
      JSON.stringify({
        documentType: 'Warranty',
        documentKind: 'registration_form',
        isForm: true,
        documentTitle: 'LG Extended Warranty Registration Form',
        issuer: 'LG India',
        formAnalysis: {
          isForm: true,
          documentKind: 'registration_form',
          formTitle: 'LG Extended Warranty Registration',
          formPurpose: 'Register an LG appliance to activate warranty coverage.',
          whoShouldFill: 'Product buyer',
          requiredDocuments: ['Tax Invoice / Purchase Receipt'],
          fields: [
            { fieldNumber: 1, fieldName: 'Model Number', fieldType: 'text', required: true, meaning: 'Appliance model code.', whatToEnter: 'Model number from sticker/invoice.', example: 'e.g., FHM1006SDW' },
            { fieldNumber: 2, fieldName: 'Serial Number', fieldType: 'text', required: true, meaning: 'Unique unit serial.', whatToEnter: 'Serial printed on warranty card.', example: 'e.g., 401KWXX000' },
            { fieldNumber: 3, fieldName: 'Date of Purchase', fieldType: 'date', required: true, meaning: 'Invoice purchase date.', whatToEnter: 'YYYY-MM-DD', example: '2026-04-12' },
          ],
        },
      })
    )
  )

  const lgProduct: StoredProduct = {
    id: 'prod_1',
    productName: 'LG Front Load Washing Machine',
    brand: 'LG',
    modelNumber: 'FHM1207SDM',
    serialNumber: 'LGWM-998877',
    purchaseDate: '2026-04-12',
    warrantyExpiry: '2028-04-12',
    warrantyDuration: '2 Years',
    warrantyStatus: 'active',
    linkedDocumentIds: ['doc_invoice_1'],
    documentRoles: { doc_invoice_1: 'invoice' },
    source: 'auto',
    createdAt: '2026-04-12T10:00:00.000Z',
    updatedAt: '2026-04-12T10:00:00.000Z',
  }

  const wState = analyzeFormPrefills({
    formDoc: warrantyForm,
    documents: [warrantyForm],
    products: [lgProduct],
    userProfile,
  })
  assert.strictEqual(wState.fields[0].prefilledValue, 'FHM1207SDM')
  assert.strictEqual(wState.fields[1].prefilledValue, 'LGWM-998877')
  assert.strictEqual(wState.fields[2].prefilledValue, '2026-04-12')

  // Test savedAnswers persistence via mergeExtractedMetadata + formatAnswerSheetText
  const updatedWarrantyExt = mergeExtractedMetadata(warrantyForm.extractedData, {
    savedFormAnswers: {
      '1': { value: 'FHM1207SDM', confirmed: true },
      '2': { value: 'LGWM-998877', confirmed: true },
    },
  })
  assert.strictEqual(updatedWarrantyExt.formAnalysis?.savedAnswers?.['1']?.value, 'FHM1207SDM')

  const sheetText = formatAnswerSheetText(wState)
  assert.ok(sheetText.includes('FHM1207SDM'))
  assert.ok(sheetText.includes('LGWM-998877'))
  assert.ok(!sheetText.includes('401KWXX000'), 'Answer sheet must NEVER treat sample example as real value')
  pass('Scenario 4: Warranty registration form prefills from StoredProduct, saves answers cleanly, formats answer sheet safely')

  // 6. Scenario 5b: Non-form guard + LifeFile Retrieval search on supportingDetails & form fields
  const noFormQuery = processFormIntelligence({
    query: 'What should I fill in this form?',
    documents: [policyDoc], // ONLY non-form doc exists
    userProfile,
  })
  assert.strictEqual(noFormQuery.isFormQuery, true)
  assert.strictEqual(noFormQuery.targetFormDoc, null)
  assert.ok(noFormQuery.groundedFormContext.includes('isForm=false'))

  const retrievalMatch = searchLifeFile('Indiranagar Bengaluru address', [policyDoc])
  assert.strictEqual(retrievalMatch.hasMatches, true)
  assert.ok(retrievalMatch.groundedContext.includes('Supporting Details'))
  pass('Scenario 5b: Non-form document guard + searchLifeFile indexing of supportingDetails')

  // 7. Live orchestrator sanity check when GEMINI_API_KEY exists (does not fail if offline/sandboxed)
  if (process.env.GEMINI_API_KEY) {
    const res = await getReasoningReply({
      messages: [{ role: 'user', content: 'What should I fill in field number 2 of the HDFC claim form?' }],
      documentsOverride: [claimFormDoc, policyDoc],
      tasksOverride: [],
      productsOverride: [],
      contactsOverride: [],
      memoriesOverride: [approvedMem],
      userProfileOverride: userProfile,
    })
    console.log('Orchestrator test success:', res.success, 'provider:', res.provider, 'formGuideDoc:', res.formGuideDoc?.documentId)
  } else {
    console.log('INFO: GEMINI_API_KEY not loaded in script env — skipped optional live Gemini call cleanly.')
  }

  console.log('ALL AI FORM FILLING GUIDE TESTS PASSED!')
}

runTests().catch((err) => {
  console.error('TEST FAILURE:', err)
  process.exit(1)
})
