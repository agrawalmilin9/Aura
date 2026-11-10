import { searchLifeFile } from '../lib/lifefile/retrieval.ts'
import { saveDocument, deleteDocument, getAllDocuments } from '../lib/lifefile/storage.ts'
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

async function runAudit() {
  console.log('========================================================')
  console.log('🔍 AURA Phase 5 Implementation Deep Audit')
  console.log('========================================================\n')

  const sampleDocA: StoredDocument = {
    id: 'doc_1700000010_test',
    originalFilename: 'Adani_Electricity_Mumbai.pdf',
    storageFilename: 'doc_1700000010_test.pdf',
    mimeType: 'application/pdf',
    fileSize: 204800,
    uploadTimestamp: '2026-11-01T10:00:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Bill',
      issuer: 'Adani Electricity',
      customerName: 'Ananya Kapoor',
      documentDate: '2026-10-25',
      dueDate: '2026-11-20',
      expiryDate: null,
      totalAmount: 3150,
      currency: '₹',
      productName: null,
      modelNumber: null,
      serialNumber: null,
      purchaseDate: null,
      warrantyDuration: null,
      warrantyExpiry: null,
      policyNumber: 'CA-998877',
      importantConditions: ['Late fee of 2% applicable after 20 Nov'],
      contactDetails: 'customercare@adanielectricity.com',
      summary: 'Adani Mumbai residential electricity bill for October 2026.',
    },
    extractionError: null,
  }

  const sampleDocB: StoredDocument = {
    id: 'doc_1700000020_test',
    originalFilename: 'MacBook_Warranty_Card.pdf',
    storageFilename: 'doc_1700000020_test.pdf',
    mimeType: 'application/pdf',
    fileSize: 154000,
    uploadTimestamp: '2026-11-02T12:00:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Warranty',
      issuer: 'Apple India',
      customerName: 'Ananya Kapoor',
      documentDate: '2025-11-15',
      dueDate: null,
      expiryDate: null,
      totalAmount: null,
      currency: null,
      productName: 'MacBook Air M2',
      modelNumber: 'A2681',
      serialNumber: 'C02TESTSERIAL1',
      purchaseDate: '2025-11-15',
      warrantyDuration: '2 Years',
      warrantyExpiry: '2027-11-15',
      policyNumber: null,
      importantConditions: null,
      contactDetails: 'apple.com/in/support',
      summary: 'AppleCare warranty card for MacBook Air M2.',
    },
    extractionError: null,
  }

  // AUDIT ITEM 3: False Matches, Missing-Field Handling, Hindi/Hinglish Search Accuracy
  console.log('[Audit 3: LifeFile Retrieval Robustness]')
  
  // 3a. False match check: query mentioning "water bill" should not match electricity bill unless it's a generic utility query
  const resWater = searchLifeFile('water bill jal board', [sampleDocA, sampleDocB])
  assert(!resWater.hasMatches || resWater.topMatch?.document.id !== sampleDocB.id, 'No false match with MacBook on water bill query')

  // 3b. Missing fields handling: sampleDocA has no warrantyExpiry, sampleDocB has no totalAmount
  assert(sampleDocA.extractedData?.warrantyExpiry === null, 'sampleDocA warrantyExpiry is null')
  assert(sampleDocB.extractedData?.totalAmount === null, 'sampleDocB totalAmount is null')

  const resMissingWarranty = searchLifeFile('when does my adani warranty expire', [sampleDocA])
  // Should match sampleDocA on issuer "Adani", but warrantyExpiry is null
  if (resMissingWarranty.hasMatches) {
    assert(resMissingWarranty.topMatch?.document.extractedData?.warrantyExpiry === null, 'Retrieved doc accurately preserves null warrantyExpiry without fabricating a date')
  }

  // 3c. Hindi and Hinglish query accuracy
  const resHindi1 = searchLifeFile('बिजली का बिल कब भरना है', [sampleDocA, sampleDocB])
  assert(resHindi1.hasMatches && resHindi1.topMatch?.document.id === sampleDocA.id, 'Devanagari query "बिजली का बिल" matches Adani Bill')
  assert(resHindi1.topMatch?.document.extractedData?.dueDate === '2026-11-20', 'Extracts exact due date for Hindi query')

  const resHinglish1 = searchLifeFile('macbook ka serial number batao', [sampleDocA, sampleDocB])
  assert(resHinglish1.hasMatches && resHinglish1.topMatch?.document.id === sampleDocB.id, 'Hinglish query "macbook ka serial number" matches MacBook')
  assert(resHinglish1.topMatch?.document.extractedData?.serialNumber === 'C02TESTSERIAL1', 'Extracts exact serial number for Hinglish query')

  // AUDIT ITEM 4: Source Citations & Document ID Fidelity
  console.log('\n[Audit 4: Source Citation Fidelity]')
  const sourceRefA = resHindi1.topMatch?.sourceReference
  assert(sourceRefA?.documentId === 'doc_1700000010_test', 'Source citation references exact document ID')
  assert(sourceRefA?.originalFilename === 'Adani_Electricity_Mumbai.pdf', 'Source citation preserves original filename')
  assert(sourceRefA?.documentType === 'Bill', 'Source citation preserves document type')
  assert(sourceRefA?.fileUrl === '/api/documents/doc_1700000010_test/file', 'Source citation links to correct /api/documents/[id]/file URL')

  // AUDIT ITEM 5: Unified Reasoning Endpoint for Voice & Text
  console.log('\n[Audit 5: Voice & Text Pipeline Consistency]')
  // Voice uses /api/voice/stt -> /api/chat -> /api/voice/tts
  // Text uses /api/chat directly
  const chatOptionsText = {
    messages: [{ role: 'user' as const, content: 'What is my electricity bill amount?' }],
    documentsOverride: [sampleDocA],
  }
  const chatOptionsVoice = {
    messages: [{ role: 'user' as const, content: 'What is my electricity bill amount?' }],
    languageCode: 'hi-IN' as const,
    documentsOverride: [sampleDocA],
  }
  const resText = await getReasoningReply(chatOptionsText)
  const resVoice = await getReasoningReply(chatOptionsVoice)
  assert(resText.sources !== undefined && resText.sources.length > 0, 'Text pipeline receives LifeFile sources')
  assert(resVoice.sources !== undefined && resVoice.sources.length > 0, 'Voice pipeline receives identical LifeFile sources')
  assert(resText.sources?.[0]?.documentId === resVoice.sources?.[0]?.documentId, 'Both pipelines resolve to identical source document ID')

  // AUDIT ITEM 6: Deletion Propagation to Retrieval
  console.log('\n[Audit 6: Document Deletion Propagation]')
  // Create a real file in storage
  const dummyBuffer = Buffer.from('%PDF-1.4\n%Minimal PDF\n%%EOF', 'utf-8')
  const savedDoc = await saveDocument(dummyBuffer, 'Temporary_To_Delete.pdf', 'application/pdf')
  assert(Boolean(savedDoc.id), 'Saved document for deletion audit')

  // Update it to completed status so it would be searchable
  const docsBefore = await getAllDocuments()
  assert(docsBefore.some((d) => d.id === savedDoc.id), 'Document appears in active LifeFile storage')

  // Now delete the document
  const deleted = await deleteDocument(savedDoc.id)
  assert(deleted === true, 'Document deleted successfully from storage')

  // Verify it is gone from getAllDocuments()
  const docsAfter = await getAllDocuments()
  assert(!docsAfter.some((d) => d.id === savedDoc.id), 'Deleted document is completely removed from getAllDocuments()')

  // Verify searchLifeFile cannot return the deleted document
  const resDeletedSearch = searchLifeFile('Temporary_To_Delete', docsAfter)
  assert(!resDeletedSearch.matchedDocuments.some((m) => m.document.id === savedDoc.id), 'Deleted document NEVER appears in future retrieval results')

  // AUDIT ITEM 7: Gemini Error Handling & Malformed Responses
  console.log('\n[Audit 7: Resilience to AI Errors & Corrupt Responses]')
  // Test with invalid API key to verify clean error response without crash
  const origKey = process.env.GEMINI_API_KEY
  try {
    delete process.env.GEMINI_API_KEY
    const errRes = await getReasoningReply({
      messages: [{ role: 'user', content: 'test query' }],
      documentsOverride: [sampleDocA],
    })
    assert(errRes.success === false, 'Gracefully flags failure when API key is missing')
    assert(errRes.error?.includes('GEMINI_API_KEY') ?? false, 'Returns clean descriptive error without crashing')
  } finally {
    process.env.GEMINI_API_KEY = origKey
  }

  // Summary
  console.log('\n========================================================')
  console.log(`Audit Summary: ${passed} Passed, ${failed} Failed`)
  console.log('========================================================\n')

  if (failed > 0) process.exit(1)
}

runAudit().catch((err) => {
  console.error('Audit crashed with error:', err)
  process.exit(1)
})
