import { validateDocumentUpload, verifyMagicBytes, MAX_DOCUMENT_FILE_SIZE } from '../lib/lifefile/validation.ts'
import {
  saveDocument,
  getAllDocuments,
  getDocumentById,
  getDocumentFileBuffer,
  updateDocument,
  deleteDocument,
  validateDocumentId,
} from '../lib/lifefile/storage.ts'
import { extractDocumentWithGemini } from '../lib/lifefile/gemini-extractor.ts'

// Minimal authentic sample file buffers
const VALID_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n',
  'utf-8'
)

// 1x1 transparent PNG
const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
  0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
  0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
  0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

// Minimal valid JPEG
const VALID_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00,
  0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06,
  0x05, 0x08, 0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b,
  0x0c, 0x19, 0x12, 0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31,
  0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff,
  0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00,
  0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xbe, 0x00, 0xff, 0xd9,
])

// Minimal valid WEBP
const VALID_WEBP = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
  0x4c, 0x0e, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x07, 0x10, 0x11, 0x23, 0x00,
  0x00, 0xbf, 0x0a, 0x00,
])

async function runTestSuite() {
  console.log('========================================================')
  console.log('📑 AURA Phase 4: LifeFile Storage & Upload Test Suite')
  console.log('========================================================\n')

  let passed = 0
  let failed = 0

  function assert(desc: string, condition: boolean, detail?: string) {
    if (condition) {
      console.log(`✅ PASS: ${desc}`)
      passed++
    } else {
      console.error(`❌ FAIL: ${desc} ${detail ? `(${detail})` : ''}`)
      failed++
    }
  }

  // --- 1. Validation Tests ---
  console.log('--- 1. File Validation Tests ---')

  const resPdf = validateDocumentUpload(VALID_PDF, 'electricity_bill.pdf', 'application/pdf')
  assert('Valid PDF accepted', resPdf.valid && resPdf.normalizedMimeType === 'application/pdf', resPdf.error)

  const resPng = validateDocumentUpload(VALID_PNG, 'warranty_receipt.png', 'image/png')
  assert('Valid PNG accepted', resPng.valid && resPng.normalizedMimeType === 'image/png', resPng.error)

  const resJpeg = validateDocumentUpload(VALID_JPEG, 'invoice.jpg', 'image/jpeg')
  assert('Valid JPEG accepted', resJpeg.valid && resJpeg.normalizedMimeType === 'image/jpeg', resJpeg.error)

  const resWebp = validateDocumentUpload(VALID_WEBP, 'document.webp', 'image/webp')
  assert('Valid WEBP accepted', resWebp.valid && resWebp.normalizedMimeType === 'image/webp', resWebp.error)

  // Unsupported file type
  const resTxt = validateDocumentUpload(Buffer.from('Hello text file'), 'notes.txt', 'text/plain')
  assert('Unsupported extension (.txt) rejected', !resTxt.valid && resTxt.error?.includes('Unsupported') === true, resTxt.error)

  // Oversized file (> 10MB)
  const oversizedBuffer = Buffer.alloc(MAX_DOCUMENT_FILE_SIZE + 1024)
  const resOversize = validateDocumentUpload(oversizedBuffer, 'huge.pdf', 'application/pdf')
  assert('Oversized file (>10MB) rejected', !resOversize.valid && resOversize.error?.includes('exceeds the maximum') === true, resOversize.error)

  // Fake extension / Invalid file signature (text file named bill.pdf)
  const fakePdf = Buffer.from('This is actually a plain text file, not a real PDF')
  const resFake = validateDocumentUpload(fakePdf, 'fake_bill.pdf', 'application/pdf')
  assert('Fake PDF (invalid magic bytes) rejected', !resFake.valid && resFake.error?.includes('File signature') === true, resFake.error)

  // Empty buffer
  const emptyRes = validateDocumentUpload(Buffer.alloc(0), 'empty.pdf', 'application/pdf')
  assert('Empty file rejected', !emptyRes.valid && emptyRes.error?.includes('empty') === true, emptyRes.error)

  // Path traversal check in ID validation
  assert('Valid document ID accepted', validateDocumentId('doc_1731234567890_a1b2c3d4'))
  assert('Path traversal in ID rejected (../)', !validateDocumentId('../etc/passwd'))
  assert('Path traversal in ID rejected (slashes)', !validateDocumentId('doc_123/456'))

  // --- 2. Storage & Persistence Tests ---
  console.log('\n--- 2. Storage & Persistence Tests ---')

  const savedDoc = await saveDocument(VALID_PDF, 'Adani_Electricity_Nov2026.pdf', 'application/pdf')
  assert('Document saved successfully with generated ID', Boolean(savedDoc.id && savedDoc.id.startsWith('doc_')), savedDoc.id)
  assert('Document storage filename is sanitized', savedDoc.storageFilename.endsWith('.pdf'), savedDoc.storageFilename)

  const retrievedDoc = await getDocumentById(savedDoc.id)
  assert('Document metadata retrieved by ID', retrievedDoc !== null && retrievedDoc.originalFilename === 'Adani_Electricity_Nov2026.pdf')

  const fileData = await getDocumentFileBuffer(savedDoc.id)
  assert('Original document binary buffer retrieved', fileData !== null && fileData.buffer.length === VALID_PDF.length)

  const allDocs = await getAllDocuments()
  assert('Document listing includes saved document', allDocs.some((d) => d.id === savedDoc.id))

  // Update extraction metadata
  const updatedDoc = await updateDocument(savedDoc.id, {
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Bill',
      issuer: 'Adani Electricity',
      customerName: 'Ananya Kapoor',
      documentDate: '2026-11-02',
      dueDate: '2026-11-25',
      expiryDate: null,
      totalAmount: 2840,
      currency: 'INR',
      productName: null,
      modelNumber: null,
      serialNumber: null,
      purchaseDate: null,
      warrantyDuration: null,
      warrantyExpiry: null,
      policyNumber: null,
      importantConditions: ['Prompt payment discount applies before 18 Nov'],
      contactDetails: '19122',
      summary: 'Adani Electricity bill for ₹2,840 due on 25 Nov 2026.',
    },
  })
  assert('Document metadata updated with extraction data', updatedDoc?.extractionStatus === 'completed' && updatedDoc.extractedData?.totalAmount === 2840)

  // Persistence check: simulate server restart by reading all docs fresh from disk
  const reloadedDocs = await getAllDocuments()
  const foundPersisted = reloadedDocs.find((d) => d.id === savedDoc.id)
  assert('Metadata survives persistent reload', foundPersisted?.extractedData?.issuer === 'Adani Electricity')

  // Deletion test
  const deleteSuccess = await deleteDocument(savedDoc.id)
  assert('Document deleted successfully', deleteSuccess === true)

  const postDeleteCheck = await getDocumentById(savedDoc.id)
  assert('Deleted document is no longer in metadata', postDeleteCheck === null)

  const postDeleteBuffer = await getDocumentFileBuffer(savedDoc.id)
  assert('Deleted document physical file is removed', postDeleteBuffer === null)

  // --- 3. Gemini Extraction Unit Tests (Mocked) ---
  console.log('\n--- 3. Gemini Extraction Unit Tests ---')

  const originalKey = process.env.GEMINI_API_KEY
  delete process.env.GEMINI_API_KEY
  const missingKeyRes = await extractDocumentWithGemini(VALID_PDF, 'application/pdf')
  assert('Fails gracefully when GEMINI_API_KEY is missing', missingKeyRes.success === false && missingKeyRes.error?.includes('GEMINI_API_KEY is not configured') === true, missingKeyRes.error)

  // Mock Gemini Success
  process.env.GEMINI_API_KEY = 'mock_gemini_key_123'
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    documentType: 'Invoice',
                    issuer: 'LG India',
                    customerName: 'Ananya Kapoor',
                    documentDate: '2026-03-15',
                    dueDate: null,
                    expiryDate: null,
                    totalAmount: 32490,
                    currency: 'INR',
                    productName: 'LG 8kg Washing Machine',
                    modelNumber: 'FHM1208ZDL',
                    serialNumber: 'LGWM-2303-8842',
                    purchaseDate: '2026-03-15',
                    warrantyDuration: '2 years',
                    warrantyExpiry: '2028-03-15',
                    policyNumber: null,
                    importantConditions: ['Comprehensive warranty includes motor and tub'],
                    contactDetails: '1800-315-9999',
                    summary: 'LG Washing machine purchase invoice with 2-year warranty.',
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }) as typeof fetch

  const mockSuccessRes = await extractDocumentWithGemini(VALID_PDF, 'application/pdf')
  assert(
    'Gemini extraction correctly parses structured JSON',
    mockSuccessRes.success === true &&
      mockSuccessRes.data?.issuer === 'LG India' &&
      mockSuccessRes.data?.totalAmount === 32490 &&
      mockSuccessRes.data?.serialNumber === 'LGWM-2303-8842',
    JSON.stringify(mockSuccessRes)
  )

  // Mock Gemini Failure (HTTP 500)
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ error: { message: 'Internal Gemini inference failure' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  const mockFailRes = await extractDocumentWithGemini(VALID_PDF, 'application/pdf')
  assert('Gemini error handled gracefully without crashing', mockFailRes.success === false && mockFailRes.data === null, mockFailRes.error)

  // Restore fetch
  globalThis.fetch = originalFetch
  if (originalKey) {
    process.env.GEMINI_API_KEY = originalKey
  } else {
    delete process.env.GEMINI_API_KEY
  }

  // --- 4. Live Gemini Multimodal Extraction Test (if key configured) ---
  if (originalKey && originalKey !== 'your_gemini_api_key_here') {
    console.log('\n--- 4. Live Gemini Multimodal Extraction Test ---')
    console.log('Sending authentic document buffer to Gemini for multimodal extraction...')

    const liveExtraction = await extractDocumentWithGemini(VALID_PDF, 'application/pdf')
    if (liveExtraction.success && liveExtraction.data) {
      console.log(`✅ Live Gemini extraction succeeded! Document Type: "${liveExtraction.data.documentType}"`)
      passed++
    } else {
      console.log(`⚠️ Live Gemini extraction result: ${liveExtraction.error}`)
    }
  }

  console.log('\n========================================================')
  console.log(`LifeFile Test Results: ${passed} Passed, ${failed} Failed`)
  console.log('========================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution failed:', err)
  process.exit(1)
})
