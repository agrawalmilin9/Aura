import assert from 'node:assert'
import {
  syncProductsFromLifeFile,
  saveProduct,
  getProductById,
  updateProduct,
  deleteProduct,
  validateProductId,
  computeWarrantyStatus,
} from '../lib/products/storage.ts'
import {
  parseContactDetails,
  sanitizeWebsiteUrl,
  syncContactsFromLifeFile,
  saveContact,
  updateContact,
  deleteContact,
  validateContactId,
} from '../lib/contacts/storage.ts'
import {
  saveMemory,
  getAllMemories,
  updateMemory,
  deleteMemory,
  detectSensitiveMemoryContent,
  validateMemoryId,
} from '../lib/memory/storage.ts'
import {
  buildProductAssistanceReport,
  processConnectedIntelligence,
} from '../lib/intelligence/connected-intelligence.ts'
import { generateProactiveSuggestions } from '../lib/intelligence/proactive-suggestions.ts'
import { getReasoningReply } from '../lib/ai/reasoning-orchestrator.ts'
import type { StoredDocument } from '../lib/lifefile/types.ts'
import type { StoredTask } from '../lib/tasks/types.ts'
import type { StoredMemory } from '../lib/memory/types.ts'

async function runTests() {
  console.log('\n=============================================================')
  console.log('🔗 AURA Phase 7: Connected Personal Intelligence Test Suite')
  console.log('=============================================================\n')

  let passed = 0
  let failed = 0

  function pass(label: string) {
    console.log(`✅ PASS: ${label}`)
    passed++
  }

  function fail(label: string, err: any) {
    console.error(`❌ FAIL: ${label}\n   Error: ${err?.message || err}`)
    failed++
  }

  const refDate = '2026-11-10'

  const sampleDocs: StoredDocument[] = [
    {
      id: 'doc_1700000001_aa11bb22',
      originalFilename: 'LG_Washing_Machine_Invoice.pdf',
      storageFilename: 'doc_1700000001_aa11bb22.pdf',
      mimeType: 'application/pdf',
      fileSize: 42000,
      uploadTimestamp: '2026-10-01T10:00:00.000Z',
      extractionStatus: 'completed',
      extractedData: {
        documentType: 'Invoice',
        issuer: 'LG India',
        customerName: 'Ananya Kapoor',
        documentDate: '2025-12-01',
        dueDate: null,
        expiryDate: null,
        totalAmount: 32490,
        currency: '₹',
        productName: 'LG 8kg Front Load Washing Machine',
        modelNumber: 'FHM1408BDL',
        serialNumber: 'LGWM-2025-8842',
        purchaseDate: '2025-12-01',
        warrantyDuration: null,
        warrantyExpiry: null,
        policyNumber: null,
        importantConditions: null,
        contactDetails: 'Helpline: 1800-315-9999 | Email: serviceindia@lge.com | https://www.lg.com/in/support',
        summary: 'Retail tax invoice for LG 8kg Washing Machine.',
      },
    },
    {
      id: 'doc_1700000002_cc33dd44',
      originalFilename: 'LG_Washing_Machine_Warranty.pdf',
      storageFilename: 'doc_1700000002_cc33dd44.pdf',
      mimeType: 'application/pdf',
      fileSize: 19000,
      uploadTimestamp: '2026-10-02T10:00:00.000Z',
      extractionStatus: 'completed',
      extractedData: {
        documentType: 'Warranty',
        issuer: 'LG India',
        customerName: 'Ananya Kapoor',
        documentDate: '2025-12-01',
        dueDate: null,
        expiryDate: null,
        totalAmount: null,
        currency: null,
        productName: 'LG 8kg Front Load Washing Machine',
        modelNumber: 'FHM1408BDL',
        serialNumber: 'LGWM-2025-8842',
        purchaseDate: '2025-12-01',
        warrantyDuration: '1 Year Comprehensive',
        warrantyExpiry: '2026-12-01', // Expiring in 21 days from 2026-11-10
        policyNumber: null,
        importantConditions: ['Covers motor and drum defects; excludes physical transit damage'],
        contactDetails: 'serviceindia@lge.com',
        summary: 'Standard 1-year comprehensive warranty card.',
      },
    },
    {
      id: 'doc_1700000003_ee55ff66',
      originalFilename: 'LG_FHM1408BDL_User_Manual.pdf',
      storageFilename: 'doc_1700000003_ee55ff66.pdf',
      mimeType: 'application/pdf',
      fileSize: 85000,
      uploadTimestamp: '2026-10-03T10:00:00.000Z',
      extractionStatus: 'completed',
      extractedData: {
        documentType: 'Manual',
        issuer: 'LG India',
        customerName: null,
        documentDate: null,
        dueDate: null,
        expiryDate: null,
        totalAmount: null,
        currency: null,
        productName: 'LG 8kg Front Load Washing Machine',
        modelNumber: 'FHM1408BDL',
        serialNumber: null,
        purchaseDate: null,
        warrantyDuration: null,
        warrantyExpiry: null,
        policyNumber: null,
        importantConditions: ['Use front-load low-foam detergent only'],
        contactDetails: null,
        summary: 'Official operation & troubleshooting manual.',
      },
    },
    {
      id: 'doc_1700000004_11223344',
      originalFilename: 'MacBook_Air_M2_Invoice.pdf',
      storageFilename: 'doc_1700000004_11223344.pdf',
      mimeType: 'application/pdf',
      fileSize: 31000,
      uploadTimestamp: '2026-10-04T10:00:00.000Z',
      extractionStatus: 'completed',
      extractedData: {
        documentType: 'Invoice',
        issuer: 'Apple India',
        customerName: 'Ananya Kapoor',
        documentDate: '2025-11-20',
        dueDate: null,
        expiryDate: null,
        totalAmount: 99900,
        currency: '₹',
        productName: 'MacBook Air M2',
        modelNumber: 'A2681',
        serialNumber: null, // Intentionally missing to test missing-info detection
        purchaseDate: '2025-11-20',
        warrantyDuration: '2 Years AppleCare',
        warrantyExpiry: '2027-11-20',
        policyNumber: null,
        importantConditions: ['Includes hardware repairs and battery service'],
        contactDetails: '1800-100-7777 | https://support.apple.com/en-in',
        summary: 'Apple Store retail invoice.',
      },
    },
    {
      id: 'doc_1700000005_55667788',
      originalFilename: 'HDFC_Ergo_Health_Policy.pdf',
      storageFilename: 'doc_1700000005_55667788.pdf',
      mimeType: 'application/pdf',
      fileSize: 54000,
      uploadTimestamp: '2026-10-05T10:00:00.000Z',
      extractionStatus: 'completed',
      extractedData: {
        documentType: 'Insurance',
        issuer: 'HDFC Ergo',
        customerName: 'Ananya Kapoor',
        documentDate: '2025-12-05',
        dueDate: null,
        expiryDate: '2026-12-05',
        totalAmount: 18500,
        currency: '₹',
        productName: null,
        modelNumber: null,
        serialNumber: null,
        purchaseDate: null,
        warrantyDuration: null,
        warrantyExpiry: null,
        policyNumber: 'HDFC-HLTH-90881',
        importantConditions: ['Cashless hospitalization across network hospitals'],
        contactDetails: 'care@hdfcergo.com | 022-6234-6234',
        summary: 'Annual health insurance policy.',
      },
    },
  ]

  // --- 1. Product Extraction, Linking & Duplicate Prevention ---
  console.log('--- 1. Product Intelligence & Document Linking ---')
  let syncedProducts: Awaited<ReturnType<typeof syncProductsFromLifeFile>>['allProducts'] = []
  try {
    const syncRes = await syncProductsFromLifeFile(sampleDocs, [])
    syncedProducts = syncRes.allProducts

    // Should merge 3 LG docs into 1 LG product + 1 MacBook Air = 2 products total
    assert.strictEqual(syncedProducts.length, 2)
    pass('Merged Invoice + Warranty + Manual into a single product without duplicates (2 distinct products)')

    const lgProd = syncedProducts.find((p) => p.productName.includes('Washing Machine'))!
    assert.ok(lgProd)
    assert.strictEqual(lgProd.linkedDocumentIds.length, 3)
    assert.strictEqual(lgProd.documentRoles[sampleDocs[0].id], 'invoice')
    assert.strictEqual(lgProd.documentRoles[sampleDocs[1].id], 'warranty')
    assert.strictEqual(lgProd.documentRoles[sampleDocs[2].id], 'manual')
    assert.strictEqual(lgProd.warrantyExpiry, '2026-12-01')
    assert.strictEqual(computeWarrantyStatus(lgProd.warrantyExpiry, refDate), 'expiring_soon')
    pass('Product merges purchaseDate, warrantyExpiry, and document roles across linked files')

    // Re-syncing the same documents in-memory should skip duplicates
    const secondSync = await syncProductsFromLifeFile(sampleDocs, syncedProducts)
    assert.strictEqual(secondSync.added.length, 0)
    assert.strictEqual(secondSync.allProducts.length, 2)
    pass('Re-syncing existing documents creates 0 duplicate product records')
  } catch (err) {
    fail('Product sync & deduplication', err)
  }

  // Persistent Product CRUD + Duplicate Rejection + Cleanup
  try {
    assert.strictEqual(validateProductId('../bad'), false)
    const first = await saveProduct({
      productName: 'Test Dyson Purifier',
      brand: 'Dyson',
      modelNumber: 'TP07',
      serialNumber: 'DYS-999-TEST',
      source: 'manual',
    })
    assert.strictEqual(first.duplicateFound, false)
    assert.ok(validateProductId(first.product.id))

    const dup = await saveProduct({
      productName: 'Dyson Air Purifier',
      brand: 'Dyson',
      serialNumber: 'DYS-999-TEST',
      warrantyExpiry: '2028-01-01',
      source: 'manual',
    })
    assert.strictEqual(dup.duplicateFound, true)
    assert.strictEqual(dup.product.id, first.product.id)
    assert.strictEqual(dup.product.warrantyExpiry, '2028-01-01')

    const updated = await updateProduct(first.product.id, { notes: 'Living room unit' })
    assert.strictEqual(updated?.notes, 'Living room unit')
    const fetched = await getProductById(first.product.id)
    assert.strictEqual(fetched?.notes, 'Living room unit')

    const removed = await deleteProduct(first.product.id)
    assert.strictEqual(removed, true)
    pass('Product persistent CRUD, ID validation, and duplicate merge verified cleanly')
  } catch (err) {
    fail('Product persistent CRUD', err)
  }

  // --- 2. Customer Support Contacts Extraction & Validation ---
  console.log('\n--- 2. Customer Support Contacts ---')
  let syncedContacts: Awaited<ReturnType<typeof syncContactsFromLifeFile>>['allContacts'] = []
  try {
    const parsed = parseContactDetails('Toll Free: 1800-315-9999 | Email: serviceindia@lge.com | https://www.lg.com/in/support')
    assert.strictEqual(parsed.phone, '1800-315-9999')
    assert.strictEqual(parsed.email, 'serviceindia@lge.com')
    assert.strictEqual(parsed.website, 'https://www.lg.com/in/support')
    assert.strictEqual(sanitizeWebsiteUrl('javascript:alert(1)'), null)
    pass('Contact parser extracts phone, email, website and rejects unsafe URL schemes')

    const contactSync = await syncContactsFromLifeFile(sampleDocs, syncedProducts, [])
    syncedContacts = contactSync.allContacts
    assert.strictEqual(syncedContacts.length, 3) // LG India, Apple India, HDFC Ergo (deduped LG!)
    const lgContact = syncedContacts.find((c) => c.companyName.includes('LG'))!
    assert.ok(lgContact)
    assert.strictEqual(lgContact.linkedDocumentIds.length, 2) // Invoice + Warranty both had LG contact
    assert.ok(lgContact.linkedProductIds.length >= 1)
    pass('Support contacts deduplicated across documents and associated with matching products')

    // Persistent Contact CRUD
    assert.strictEqual(validateContactId('bad_id'), false)
    const createdC = await saveContact({
      companyName: 'Test Kent RO Support',
      phone: '9278912345',
      email: 'service@kent.co.in',
      website: 'kent.co.in',
    })
    assert.strictEqual(createdC.contact.website, 'https://kent.co.in/')
    const updC = await updateContact(createdC.contact.id, { notes: 'Annual AMC' })
    assert.strictEqual(updC?.notes, 'Annual AMC')
    assert.strictEqual(await deleteContact(createdC.contact.id), true)
    pass('Support contact persistent CRUD & URL normalization verified')
  } catch (err) {
    fail('Customer support contacts', err)
  }

  // --- 3. User-Controlled Personal Memory & Privacy Guard ---
  console.log('\n--- 3. Personal Memory Permission & Privacy ---')
  try {
    // 1. Reject without explicit user approval
    const unapproved = await saveMemory({
      content: 'Prefer evening technician visits after 6 PM',
      category: 'preference',
      approvedByUser: false,
    })
    assert.strictEqual(unapproved.success, false)
    pass('Blocked saving memory without explicit approvedByUser=true flag')

    // 2. Reject sensitive credentials / PII
    assert.strictEqual(detectSensitiveMemoryContent('My ATM PIN is 4829').isSensitive, true)
    assert.strictEqual(detectSensitiveMemoryContent('Aadhaar 1234 5678 9012').isSensitive, true)
    assert.strictEqual(detectSensitiveMemoryContent('PAN ABCDE1234F').isSensitive, true)

    const sensitiveSave = await saveMemory({
      content: 'My ATM PIN is 4829',
      category: 'other',
      approvedByUser: true,
    })
    assert.strictEqual(sensitiveSave.success, false)
    pass('Privacy guard blocked storing sensitive credentials/IDs even if submitted')

    // 3. Approved non-sensitive memory CRUD
    assert.strictEqual(validateMemoryId('bad_mem'), false)
    const savedMem = await saveMemory({
      content: 'Prefer Saturday morning appliance service visits',
      category: 'preference',
      approvedByUser: true,
    })
    assert.strictEqual(savedMem.success, true)
    assert.ok(savedMem.memory)
    const allMems = await getAllMemories()
    assert.ok(allMems.some((m) => m.id === savedMem.memory!.id))

    const editedMem = await updateMemory(savedMem.memory!.id, {
      content: 'Prefer Sunday morning appliance service visits',
    })
    assert.strictEqual(editedMem.success, true)
    assert.strictEqual(editedMem.memory?.content, 'Prefer Sunday morning appliance service visits')

    assert.strictEqual(await deleteMemory(savedMem.memory!.id), true)
    pass('Approved Personal Memory CRUD works and cleans up properly')
  } catch (err) {
    fail('Personal memory permissions & privacy', err)
  }

  // --- 4. Document-Based Assistance & Missing Info Detection ---
  console.log('\n--- 4. Document-Based Assistance (Facts vs Drafts vs Missing Info) ---')
  try {
    const macProd = syncedProducts.find((p) => p.productName.includes('MacBook'))!
    const lgProd = syncedProducts.find((p) => p.productName.includes('Washing Machine'))!

    const macChecklist = buildProductAssistanceReport({
      product: macProd,
      documents: sampleDocs,
      contacts: syncedContacts,
      mode: 'warranty_checklist',
    })
    assert.ok(macChecklist.extractedFacts.some((f) => f.includes('MacBook Air M2')))
    assert.ok(macChecklist.missingInformation.some((m) => m.toLowerCase().includes('serial number')))
    assert.strictEqual(macChecklist.sources.length, 1)
    assert.strictEqual(macChecklist.sources[0].originalFilename, 'MacBook_Air_M2_Invoice.pdf')
    pass('Warranty checklist identifies missing Serial Number on MacBook and cites Invoice source')

    const lgEmailDraft = buildProductAssistanceReport({
      product: lgProd,
      documents: sampleDocs,
      contacts: syncedContacts,
      mode: 'support_email_draft',
      issueSummary: 'Spin cycle vibration check',
    })
    assert.ok(lgEmailDraft.suggestionsAndDraft.includes('serviceindia@lge.com'))
    assert.ok(lgEmailDraft.suggestionsAndDraft.includes('Requires Your Review & Approval'))
    assert.strictEqual(lgEmailDraft.sources.length, 3)
    pass('Support email draft populates extracted helpline email without auto-sending and cites 3 LG docs')
  } catch (err) {
    fail('Document-based assistance', err)
  }

  // --- 5. Connected Queries, Memory Proposal & Source Citations ---
  console.log('\n--- 5. Connected Cross-Module Queries & Citations ---')
  const testTasks: StoredTask[] = [
    {
      id: 'task_1700000010_abcd1234',
      title: 'Renew HDFC Ergo insurance policy',
      description: 'Policy HDFC-HLTH-90881 due on 2026-12-05',
      category: 'insurance',
      dueDate: '2026-12-05',
      status: 'pending',
      priority: 'medium',
      linkedDocumentId: sampleDocs[4].id,
      linkedDocumentName: sampleDocs[4].originalFilename,
      source: 'auto',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
  ]

  const approvedMemList: StoredMemory[] = [
    {
      id: 'mem_1700000020_1234abcd',
      content: 'Prefer SMS or email updates over daytime phone calls',
      category: 'preference',
      approvedByUser: true,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:00.000Z',
    },
  ]

  try {
    const q1 = processConnectedIntelligence({
      query: 'Which products have warranties expiring soon?',
      documents: sampleDocs,
      products: syncedProducts,
      contacts: syncedContacts,
      tasks: testTasks,
      memories: approvedMemList,
      referenceDate: refDate,
    })
    assert.strictEqual(q1.isConnectedQuery, true)
    assert.ok(q1.connectedContext.includes('LG 8kg Front Load Washing Machine'))
    assert.ok(q1.additionalSources.some((s) => s.documentId === sampleDocs[1].id))
    pass('Query "Which products have warranties expiring soon?" returns expiring LG product + source citation')

    const q2 = processConnectedIntelligence({
      query: 'Show my products with their invoices and manuals.',
      documents: sampleDocs,
      products: syncedProducts,
      contacts: syncedContacts,
      tasks: testTasks,
      memories: approvedMemList,
      referenceDate: refDate,
    })
    assert.ok(q2.connectedContext.includes('LG_Washing_Machine_Invoice.pdf [invoice]'))
    assert.ok(q2.connectedContext.includes('LG_FHM1408BDL_User_Manual.pdf [manual]'))
    assert.ok(q2.additionalSources.length >= 4)
    pass('Query "Show my products with their invoices and manuals." resolves grouped roles & citations')

    const q3 = processConnectedIntelligence({
      query: 'Which company should I contact for my washing machine?',
      documents: sampleDocs,
      products: syncedProducts,
      contacts: syncedContacts,
      tasks: testTasks,
      memories: approvedMemList,
      referenceDate: refDate,
    })
    assert.ok(q3.connectedContext.includes('LG India'))
    assert.ok(q3.connectedContext.includes('1800-315-9999'))
    assert.ok(q3.connectedContext.includes('serviceindia@lge.com'))
    pass('Query "Which company should I contact for my washing machine?" resolves LG support details')

    const q4 = processConnectedIntelligence({
      query: 'Which upcoming tasks are linked to my insurance documents?',
      documents: sampleDocs,
      products: syncedProducts,
      contacts: syncedContacts,
      tasks: testTasks,
      memories: approvedMemList,
      referenceDate: refDate,
    })
    assert.ok(q4.connectedContext.includes('Renew HDFC Ergo insurance policy'))
    assert.ok(q4.additionalSources.some((s) => s.documentId === sampleDocs[4].id))
    pass('Query "Which upcoming tasks are linked to my insurance documents?" joins tasks & documents')

    // Explicit memory request produces proposal WITHOUT silent save
    const memBefore = await getAllMemories()
    const q5 = processConnectedIntelligence({
      query: 'Remember that my preferred service centre is Andheri West',
      documents: sampleDocs,
      products: syncedProducts,
      contacts: syncedContacts,
      tasks: testTasks,
      memories: approvedMemList,
      referenceDate: refDate,
    })
    const memAfter = await getAllMemories()
    assert.strictEqual(memBefore.length, memAfter.length)
    assert.ok(q5.memoryProposal)
    assert.strictEqual(q5.memoryProposal?.proposedContent, 'my preferred service centre is Andheri West')
    assert.ok(q5.memoryContext.toLowerCase().includes('separate from extracted document facts'))
    pass('Explicit "Remember that..." proposes memory for approval without silently writing to storage')
  } catch (err) {
    fail('Connected cross-module queries', err)
  }

  // --- 6. Proactive Suggestions (Non-Executing) ---
  console.log('\n--- 6. Proactive Suggestions ---')
  try {
    const suggestions = generateProactiveSuggestions({
      documents: sampleDocs,
      products: syncedProducts,
      tasks: testTasks,
      contacts: syncedContacts,
      referenceDate: refDate,
    })
    assert.ok(suggestions.length >= 3)
    assert.ok(suggestions.every((s) => s.requiresConfirmation === true))
    assert.ok(suggestions.some((s) => s.type === 'warranty_check' && s.title.includes('Washing Machine')))
    assert.ok(suggestions.some((s) => s.type === 'insurance_checklist'))
    assert.ok(suggestions.some((s) => s.type === 'missing_claim_info' && s.title.includes('MacBook')))
    pass('Proactive suggestions cover expiring warranty, insurance renewal checklist & missing claim info without auto-executing')
  } catch (err) {
    fail('Proactive suggestions', err)
  }

  // --- 7. Live Gemini Connected Intelligence Integration ---
  if (process.env.GEMINI_API_KEY) {
    console.log('\n📡 Live GEMINI_API_KEY detected. Testing end-to-end connected query...')
    try {
      const liveRes = await getReasoningReply({
        messages: [
          {
            role: 'user',
            content: 'Which company should I contact for my washing machine and when does its warranty expire?',
          },
        ],
        documentsOverride: sampleDocs,
        productsOverride: syncedProducts,
        contactsOverride: syncedContacts,
        tasksOverride: testTasks,
        memoriesOverride: approvedMemList,
        referenceDate: refDate,
      })
      assert.strictEqual(liveRes.success, true)
      assert.ok(liveRes.reply.toLowerCase().includes('lg'))
      assert.ok(
        liveRes.reply.includes('1800') || liveRes.reply.toLowerCase().includes('serviceindia@lge.com')
      )
      assert.ok((liveRes.sources?.length || 0) >= 1)
      console.log(`   Live AURA Reply: "${liveRes.reply}"`)
      pass('Live Gemini connected intelligence replied with verified LG contact, expiry, and source citations')
    } catch (err) {
      fail('Live Gemini connected intelligence test', err)
    }
  } else {
    console.log('⚠️ Skipping live Gemini connected test (GEMINI_API_KEY not in env).')
  }

  console.log('\n=============================================================')
  console.log(`Phase 7 Connected Intelligence Results: ${passed} Passed, ${failed} Failed`)
  console.log('=============================================================\n')

  if (failed > 0) process.exit(1)
}

runTests()
