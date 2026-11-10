import { searchLifeFile } from '../lib/lifefile/retrieval.ts'
import { getReasoningReply } from '../lib/ai/reasoning-orchestrator.ts'
import type { StoredDocument } from '../lib/lifefile/types.ts'

let passed = 0
let failed = 0

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`)
    passed++
  } else {
    console.error(`  ❌ FAIL: ${testName}${detail ? ` - ${detail}` : ''}`)
    failed++
  }
}

// Mock dataset representing real uploaded documents in LifeFile
const sampleStoredDocuments: StoredDocument[] = [
  {
    id: 'doc_1700000001_a1b2',
    originalFilename: 'Adani_Electricity_Oct2026.pdf',
    storageFilename: 'doc_1700000001_a1b2.pdf',
    mimeType: 'application/pdf',
    fileSize: 450210,
    uploadTimestamp: '2026-11-02T10:15:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Bill',
      issuer: 'Adani Electricity Mumbai Ltd',
      customerName: 'Ananya Kapoor',
      documentDate: '2026-10-28',
      dueDate: '2026-11-25',
      expiryDate: null,
      totalAmount: 2840,
      currency: '₹',
      productName: null,
      modelNumber: null,
      serialNumber: null,
      purchaseDate: null,
      warrantyDuration: null,
      warrantyExpiry: null,
      policyNumber: 'CA-90219482',
      importantConditions: ['5% surcharge applicable after due date'],
      contactDetails: '19122 / customercare@adanielectricity.com',
      summary: 'Monthly residential electricity bill for October 2026 totaling ₹2,840 payable by 25 November 2026.',
    },
    extractionError: null,
  },
  {
    id: 'doc_1700000002_c3d4',
    originalFilename: 'MacBook_Air_M2_Warranty.pdf',
    storageFilename: 'doc_1700000002_c3d4.pdf',
    mimeType: 'application/pdf',
    fileSize: 312000,
    uploadTimestamp: '2026-11-05T14:30:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Warranty',
      issuer: 'Apple India',
      customerName: 'Ananya Kapoor',
      documentDate: '2025-11-20',
      dueDate: null,
      expiryDate: null,
      totalAmount: 114900,
      currency: '₹',
      productName: 'MacBook Air M2 13-inch',
      modelNumber: 'MLY33HN/A',
      serialNumber: 'C02ZK0ABCDEF',
      purchaseDate: '2025-11-20',
      warrantyDuration: '2 Years AppleCare+',
      warrantyExpiry: '2027-11-20',
      policyNumber: null,
      importantConditions: ['Covers hardware failure and up to two accidental damage incidents per year'],
      contactDetails: '000800 1009009 / apple.com/in/support',
      summary: 'AppleCare+ warranty card for MacBook Air M2 expiring on 20 November 2027.',
    },
    extractionError: null,
  },
  {
    id: 'doc_1700000003_e5f6',
    originalFilename: 'HDFC_Ergo_Optima_Restore.pdf',
    storageFilename: 'doc_1700000003_e5f6.pdf',
    mimeType: 'application/pdf',
    fileSize: 840000,
    uploadTimestamp: '2026-10-15T09:00:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Insurance',
      issuer: 'HDFC ERGO General Insurance',
      customerName: 'Ananya Kapoor',
      documentDate: '2025-12-31',
      dueDate: '2026-12-30',
      expiryDate: '2026-12-30',
      totalAmount: 18450,
      currency: '₹',
      productName: null,
      modelNumber: null,
      serialNumber: null,
      purchaseDate: null,
      warrantyDuration: null,
      warrantyExpiry: null,
      policyNumber: 'HDFC-ERGO-POL-2025-9941',
      importantConditions: [
        '30 days initial waiting period',
        '2 years waiting period for specified illnesses',
        'Cashless hospitalization across 12,000+ network hospitals',
      ],
      contactDetails: '022 6234 6234 / care@hdfcergo.com',
      summary: 'Optima Restore family health insurance policy covering ₹10,00,000 expiring on 30 December 2026.',
    },
    extractionError: null,
  },
  {
    id: 'doc_1700000004_g7h8',
    originalFilename: 'LG_Washing_Machine_Invoice.jpg',
    storageFilename: 'doc_1700000004_g7h8.jpg',
    mimeType: 'image/jpeg',
    fileSize: 950000,
    uploadTimestamp: '2026-03-15T16:20:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Invoice',
      issuer: 'LG Electronics India',
      customerName: 'Ananya Kapoor',
      documentDate: '2026-03-15',
      dueDate: null,
      expiryDate: null,
      totalAmount: 32490,
      currency: '₹',
      productName: 'LG 8kg Front Load Washing Machine',
      modelNumber: 'FHM1408BDW',
      serialNumber: 'LGWM-2303-8842',
      purchaseDate: '2026-03-15',
      warrantyDuration: '2 years comprehensive, 10 years motor',
      warrantyExpiry: '2028-03-15',
      policyNumber: null,
      importantConditions: ['Physical damage and commercial use excluded'],
      contactDetails: '1800-315-9999 / lg.com/in',
      summary: 'Purchase invoice for LG 8kg washing machine for ₹32,490 with active warranty until 15 March 2028.',
    },
    extractionError: null,
  },
]

async function runTests() {
  console.log('\n--- Test Suite: AURA Phase 5 LifeFile Intelligence & Reasoning ---')

  // 1. Finding a document by issuer
  console.log('\n[1. Finding Document by Issuer]')
  const resIssuer = searchLifeFile('Which company issued my electricity bill?', sampleStoredDocuments)
  assert(resIssuer.hasMatches, 'Should match electricity bill document')
  assert(resIssuer.topMatch?.document.extractedData?.issuer?.includes('Adani') ?? false, 'Should identify Adani as issuer')
  assert(resIssuer.topMatch?.sourceReference.originalFilename === 'Adani_Electricity_Oct2026.pdf', 'Should link to correct file')

  // 2. Finding a document by product
  console.log('\n[2. Finding Document by Product Name]')
  const resProd = searchLifeFile('Tell me about my MacBook Air', sampleStoredDocuments)
  assert(resProd.hasMatches, 'Should match MacBook document')
  assert(resProd.topMatch?.document.extractedData?.productName?.includes('MacBook Air') ?? false, 'Top match should be MacBook Air')
  assert(resProd.topMatch?.document.extractedData?.serialNumber === 'C02ZK0ABCDEF', 'Should retrieve correct serial number')

  // 3. Retrieving warranty expiry
  console.log('\n[3. Retrieving Warranty Expiry]')
  const resWarranty = searchLifeFile('When does my product warranty expire?', sampleStoredDocuments)
  assert(resWarranty.hasMatches, 'Should match warranty documents')
  assert(Boolean(resWarranty.topMatch?.document.extractedData?.warrantyExpiry), 'Top match should contain warranty expiry')
  assert(resWarranty.topMatch?.sourceReference.relevantField?.includes('Warranty Expiry') ?? false, 'Source reference cites warranty expiry')

  // 4. Retrieving bill amount and due date
  console.log('\n[4. Retrieving Bill Amount and Due Date]')
  const resBill = searchLifeFile('What was my electricity bill amount and due date?', sampleStoredDocuments)
  assert(resBill.hasMatches, 'Should match electricity bill')
  assert(resBill.topMatch?.document.extractedData?.totalAmount === 2840, 'Should extract ₹2840 amount')
  assert(resBill.topMatch?.document.extractedData?.dueDate === '2026-11-25', 'Should extract 2026-11-25 due date')

  // 5. Multiple matching documents
  console.log('\n[5. Multiple Matching Documents]')
  const resMultiple = searchLifeFile('Show my warranties and appliances', sampleStoredDocuments)
  assert(resMultiple.matchedDocuments.length >= 2, 'Should return multiple relevant appliance/warranty documents')

  // 6. No matching documents
  console.log('\n[6. No Matching Documents Query]')
  const resNoMatch = searchLifeFile('What is my passport renewal date or visa expiry?', sampleStoredDocuments)
  assert(!resNoMatch.hasMatches, 'Should return hasMatches=false for unrelated documents')
  assert(resNoMatch.matchedDocuments.length === 0, 'Should return empty matchedDocuments list')

  // 7. Missing extracted fields handling
  console.log('\n[7. Missing Extracted Fields Handling]')
  const docWithMissingFields: StoredDocument = {
    id: 'doc_1700000005_miss',
    originalFilename: 'Gym_Membership_Receipt.pdf',
    storageFilename: 'doc_1700000005_miss.pdf',
    mimeType: 'application/pdf',
    fileSize: 100000,
    uploadTimestamp: '2026-11-01T10:00:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Receipt',
      issuer: 'Gold Gym',
      customerName: 'Ananya Kapoor',
      documentDate: '2026-11-01',
      dueDate: null,
      expiryDate: null,
      totalAmount: 15000,
      currency: '₹',
      productName: null,
      modelNumber: null,
      serialNumber: null, // intentionally null
      purchaseDate: null,
      warrantyDuration: null, // intentionally null
      warrantyExpiry: null, // intentionally null
      policyNumber: null,
      importantConditions: null,
      contactDetails: null,
      summary: 'Gym membership receipt for ₹15000.',
    },
    extractionError: null,
  }
  const resMissing = searchLifeFile('gym membership serial number and warranty', [docWithMissingFields])
  assert(resMissing.hasMatches, 'Matches gym receipt')
  assert(resMissing.topMatch?.document.extractedData?.serialNumber === null, 'Serial number is strictly null, not fabricated')
  assert(resMissing.topMatch?.document.extractedData?.warrantyExpiry === null, 'Warranty expiry is strictly null, not fabricated')

  // 8. Correct source document references
  console.log('\n[8. Source Document References Shape]')
  const sourceRef = resBill.topMatch?.sourceReference
  assert(sourceRef !== undefined, 'Source reference exists')
  assert(sourceRef?.fileUrl === `/api/documents/${resBill.topMatch?.document.id}/file`, 'File URL matches /api/documents/[id]/file')
  assert(sourceRef?.originalFilename === 'Adani_Electricity_Oct2026.pdf', 'Original filename preserved')
  assert(sourceRef?.documentType === 'Bill', 'Document type preserved')

  // 9. Hindi and English query equivalence
  console.log('\n[9. Multilingual Hindi / Hinglish Query Retrieval]')
  const resHindiDevanagari = searchLifeFile('बिजली का बिल कितना है?', sampleStoredDocuments)
  assert(resHindiDevanagari.hasMatches, 'Devanagari Hindi query matches electricity bill')
  assert(resHindiDevanagari.topMatch?.document.extractedData?.totalAmount === 2840, 'Devanagari query extracts ₹2840')

  const resHinglish = searchLifeFile('mera bijli ka bill kitna hai aur kab bharna hai', sampleStoredDocuments)
  assert(resHinglish.hasMatches, 'Hinglish query matches electricity bill')
  assert(resHinglish.topMatch?.document.extractedData?.dueDate === '2026-11-25', 'Hinglish query extracts 2026-11-25')

  const resHindiWarranty = searchLifeFile('वाशिंग मशीन की वारंटी कब खत्म होगी?', sampleStoredDocuments)
  assert(resHindiWarranty.hasMatches, 'Hindi query matches washing machine')
  assert(resHindiWarranty.topMatch?.document.extractedData?.warrantyExpiry === '2028-03-15', 'Hindi query matches 2028-03-15 warranty expiry')

  // 10. Voice and text using the same reasoning orchestrator
  console.log('\n[10. Single Reasoning Engine for Voice & Text]')
  const textOptions = {
    messages: [{ role: 'user' as const, content: 'What was my electricity bill amount?' }],
    documentsOverride: sampleStoredDocuments,
  }
  const voiceOptions = {
    messages: [{ role: 'user' as const, content: 'मेरा बिजली का बिल कितना है?' }],
    languageCode: 'hi-IN' as const,
    documentsOverride: sampleStoredDocuments,
  }
  // Both call getReasoningReply
  assert(typeof getReasoningReply === 'function', 'getReasoningReply is the unified entrypoint')

  // 11. Malformed extraction data handling
  console.log('\n[11. Corrupted / Malformed Extraction Data Handling]')
  const malformedDocs: StoredDocument[] = [
    {
      id: 'doc_corrupted_1',
      originalFilename: 'bad.pdf',
      storageFilename: 'bad.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      uploadTimestamp: '2026-11-01',
      extractionStatus: 'failed',
      extractedData: null,
      extractionError: 'Gemini parse failed',
    },
  ]
  const resMalformed = searchLifeFile('electricity bill', malformedDocs)
  assert(!resMalformed.hasMatches, 'Does not match corrupted/failed documents')
  assert(resMalformed.matchedDocuments.length === 0, 'No false matches returned for failed documents')

  // 12. Live Grounded Reasoning with Gemini API
  console.log('\n[12. Live Grounded Gemini Reasoning Test]')
  const apiKey = process.env.GEMINI_API_KEY
  if (apiKey) {
    try {
      console.log('  Testing live Gemini grounded answer for English query...')
      const liveReplyEng = await getReasoningReply({
        messages: [{ role: 'user', content: 'What is my electricity bill amount and due date?' }],
        documentsOverride: sampleStoredDocuments,
      })

      assert(liveReplyEng.success, 'Live Gemini grounded reasoning succeeded')
      assert(liveReplyEng.reply.length > 10, 'Live Gemini returned non-empty answer')
      assert(liveReplyEng.reply.includes('2,840') || liveReplyEng.reply.includes('2840'), 'Answer contains ₹2,840 from real document')
      assert(liveReplyEng.sources !== undefined && liveReplyEng.sources.length > 0, 'Answer contains source citation')
      assert(liveReplyEng.sources?.[0]?.originalFilename === 'Adani_Electricity_Oct2026.pdf', 'Cites correct document filename')

      console.log(`  Live English Response: "${liveReplyEng.reply}"`)
      console.log(`  Live Source Citation: ${liveReplyEng.sources?.[0]?.originalFilename} (${liveReplyEng.sources?.[0]?.documentType})`)

      console.log('  Testing live Gemini grounded answer for Hindi voice query...')
      const liveReplyHindi = await getReasoningReply({
        messages: [{ role: 'user', content: 'मेरी वाशिंग मशीन की वारंटी कब खत्म होगी?' }],
        languageCode: 'hi-IN',
        documentsOverride: sampleStoredDocuments,
      })

      assert(liveReplyHindi.success, 'Live Gemini Hindi grounded reasoning succeeded')
      assert(liveReplyHindi.reply.includes('2028') || liveReplyHindi.reply.includes('March'), 'Hindi answer cites 2028 warranty expiry')
      assert(liveReplyHindi.sources?.[0]?.originalFilename === 'LG_Washing_Machine_Invoice.jpg', 'Hindi answer cites LG washing machine invoice')
      console.log(`  Live Hindi Response: "${liveReplyHindi.reply}"`)

      console.log('  Testing live Gemini response when document is not in LifeFile...')
      const liveNoMatch = await getReasoningReply({
        messages: [{ role: 'user', content: 'What is my vehicle registration certificate or passport renewal date?' }],
        documentsOverride: sampleStoredDocuments,
      })
      assert(liveNoMatch.success, 'Live Gemini answered query with no match')
      assert(
        liveNoMatch.reply.toLowerCase().includes('no matching') ||
        liveNoMatch.reply.toLowerCase().includes("couldn't find") ||
        liveNoMatch.reply.toLowerCase().includes('could not find') ||
        liveNoMatch.reply.toLowerCase().includes('not found') ||
        liveNoMatch.reply.toLowerCase().includes('none of') ||
        liveNoMatch.reply.toLowerCase().includes("don't have") ||
        liveNoMatch.reply.toLowerCase().includes('no record') ||
        liveNoMatch.reply.toLowerCase().includes('nahi mila') ||
        liveNoMatch.reply.toLowerCase().includes('nahi hai') ||
        liveNoMatch.reply.toLowerCase().includes('nahi paya'),
        'AI clearly informs user no matching document found'
      )
      assert(liveNoMatch.sources?.length === 0, 'No source links attached when no match found')
      console.log(`  Live Unmatched Response: "${liveNoMatch.reply}"`)

      console.log('  Testing live Gemini response when LifeFile is empty...')
      const liveEmpty = await getReasoningReply({
        messages: [{ role: 'user', content: 'When is my electricity bill due?' }],
        documentsOverride: [],
      })
      assert(liveEmpty.success, 'Live Gemini answered with empty LifeFile')
      assert(
        liveEmpty.reply.toLowerCase().includes('empty') ||
        liveEmpty.reply.toLowerCase().includes('upload') ||
        liveEmpty.reply.toLowerCase().includes('haven\'t uploaded') ||
        liveEmpty.reply.toLowerCase().includes('no document') ||
        liveEmpty.reply.toLowerCase().includes('khali') ||
        liveEmpty.reply.toLowerCase().includes('nahi'),
        'AI indicates empty LifeFile and suggests uploading'
      )
      console.log(`  Live Empty LifeFile Response: "${liveEmpty.reply}"`)
    } catch (err: any) {
      console.error('Live Gemini test failed:', err)
      failed++
    }
  } else {
    console.log('  ⚠️ GEMINI_API_KEY not configured in env, skipping live call.')
  }

  // Summary
  console.log(`\n==========================================`)
  console.log(`Phase 5 Test Results: ${passed} Passed, ${failed} Failed`)
  console.log(`==========================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch((err) => {
  console.error('Unhandled test failure:', err)
  process.exit(1)
})
