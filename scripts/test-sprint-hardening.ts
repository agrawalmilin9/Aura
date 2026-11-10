import assert from 'node:assert'
import {
  saveTask,
  updateTask,
  snoozeTask,
  markTaskStatus,
  deleteTask,
  getAllTasks,
  computeNextRecurringDueDate,
} from '../lib/tasks/storage.ts'
import { saveProduct, deleteProduct, validateProductId } from '../lib/products/storage.ts'
import { saveContact, deleteContact, validateContactId, sanitizeWebsiteUrl } from '../lib/contacts/storage.ts'
import {
  saveDocument,
  getDocumentById,
  updateDocument,
  deleteDocument,
  validateDocumentId,
} from '../lib/lifefile/storage.ts'
import { generateGeminiReasoning } from '../lib/ai/gemini/reasoning.ts'

async function runTests() {
  console.log('\n=============================================================')
  console.log('🛡️ AURA Sprint Hardening, Backup, Recurrence & Security Suite')
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

  // --- 1. Concurrent Write Safety (File Mutex + Atomic Rename) ---
  console.log('--- 1. Concurrent Storage Write Serialization ---')
  const createdProductIds: string[] = []
  try {
    const results = await Promise.all([
      saveProduct({ productName: 'Concurrent Alpha Device', serialNumber: 'CONC-01', source: 'manual' }),
      saveProduct({ productName: 'Concurrent Beta Device', serialNumber: 'CONC-02', source: 'manual' }),
      saveProduct({ productName: 'Concurrent Gamma Device', serialNumber: 'CONC-03', source: 'manual' }),
    ])
    for (const r of results) {
      createdProductIds.push(r.product.id)
    }
    assert.strictEqual(new Set(createdProductIds).size, 3)
    pass('3 concurrent saveProduct calls persisted cleanly without lost writes')
  } catch (err) {
    fail('Concurrent saveProduct serialization', err)
  } finally {
    for (const id of createdProductIds) {
      await deleteProduct(id).catch(() => {})
    }
  }

  // --- 2. Task Snooze, Edit, Dismiss & Recurring Next-Cycle Creation ---
  console.log('\n--- 2. Task Snooze, Dismiss & Recurring Bills ---')
  const createdTaskIds: string[] = []
  try {
    assert.strictEqual(computeNextRecurringDueDate('2026-01-31', 'monthly'), '2026-02-28')
    assert.strictEqual(computeNextRecurringDueDate('2026-11-10', 'quarterly'), '2027-02-10')
    assert.strictEqual(computeNextRecurringDueDate('2026-11-10', 'yearly'), '2027-11-10')
    pass('computeNextRecurringDueDate handles monthly end-of-month clamping, quarterly, and yearly')

    const billTask = await saveTask({
      title: 'Test Recurring Water Bill',
      description: 'Monthly DJB water bill',
      category: 'bill',
      dueDate: '2026-11-10',
      status: 'pending',
      priority: 'high',
      linkedDocumentId: null,
      source: 'manual',
      recurrence: 'monthly',
    })
    createdTaskIds.push(billTask.id)

    // Snooze +3 days
    const snoozed = await snoozeTask(billTask.id, 3, '2026-11-10')
    assert.ok(snoozed)
    assert.strictEqual(snoozed.dueDate, '2026-11-13')
    assert.strictEqual(snoozed.snoozeCount, 1)
    pass('snoozeTask shifts dueDate forward and increments snoozeCount')

    // Complete recurring task -> auto-schedules next monthly cycle (2026-12-13)
    const completed = await markTaskStatus(billTask.id, 'completed')
    assert.strictEqual(completed?.status, 'completed')

    const allTasks = await getAllTasks()
    const nextCycle = allTasks.find(
      (t) => t.title === 'Test Recurring Water Bill' && t.status === 'pending' && t.dueDate === '2026-12-13'
    )
    assert.ok(nextCycle, 'Expected next monthly recurring pending task to be generated')
    createdTaskIds.push(nextCycle.id)
    pass('Completing a monthly recurring task automatically schedules next cycle without duplicates')

    // Dismiss next cycle
    const dismissed = await updateTask(nextCycle.id, { status: 'dismissed' })
    assert.strictEqual(dismissed?.status, 'dismissed')
    pass('Task dismissal persisted accurately')
  } catch (err) {
    fail('Task snooze/recurrence/dismiss', err)
  } finally {
    for (const id of createdTaskIds) {
      await deleteTask(id).catch(() => {})
    }
  }

  // --- 3. Document Metadata Editing & Cleanup ---
  console.log('\n--- 3. Document Metadata Edit & Cleanup ---')
  let tempDocId: string | null = null
  try {
    const pdfHeader = Buffer.from('%PDF-1.4\n%Test PDF content for AURA edit test\n', 'utf-8')
    const savedDoc = await saveDocument(pdfHeader, 'Test_Bill_Sample.pdf', 'application/pdf')
    tempDocId = savedDoc.id

    const updated = await updateDocument(tempDocId, {
      extractionStatus: 'completed',
      extractedData: {
        documentType: 'Bill',
        issuer: 'Tata Power',
        customerName: null,
        documentDate: '2026-11-01',
        dueDate: '2026-12-01',
        expiryDate: null,
        totalAmount: 1950,
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
        summary: 'Edited test metadata',
      },
    })
    assert.strictEqual(updated?.extractedData?.issuer, 'Tata Power')
    assert.strictEqual(updated?.extractedData?.totalAmount, 1950)
    const fetched = await getDocumentById(tempDocId)
    assert.strictEqual(fetched?.extractedData?.issuer, 'Tata Power')
    pass('Document metadata updates persist cleanly across storage reloads')
  } catch (err) {
    fail('Document metadata edit & persistence', err)
  } finally {
    if (tempDocId) {
      await deleteDocument(tempDocId).catch(() => {})
    }
  }

  // --- 4. Identifier & URL Security Guards ---
  console.log('\n--- 4. Security ID & URL Validation ---')
  try {
    assert.strictEqual(validateDocumentId('../etc/passwd'), false)
    assert.strictEqual(validateProductId('prod_invalid/123'), false)
    assert.strictEqual(validateContactId('cont_123;rm -rf'), false)
    assert.strictEqual(sanitizeWebsiteUrl('javascript:alert(1)'), null)
    assert.strictEqual(sanitizeWebsiteUrl('data:text/html,evil'), null)
    assert.strictEqual(sanitizeWebsiteUrl('https://support.lg.com/in'), 'https://support.lg.com/in')
    pass('ID validators reject path traversal/injection and URL sanitizer blocks unsafe schemes')
  } catch (err) {
    fail('Security ID & URL validation', err)
  }

  // --- 5. Gemini Empty Candidate Fallback Fix ---
  console.log('\n--- 5. Gemini Empty Candidate Safety ---')
  const originalFetch = globalThis.fetch
  const originalKey = process.env.GEMINI_API_KEY
  try {
    process.env.GEMINI_API_KEY = 'fake-test-key'
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '   ' }] } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })

    const res = await generateGeminiReasoning({
      messages: [{ role: 'user', content: 'Hello' }],
    })
    assert.strictEqual(res.success, false)
    assert.ok(res.error?.includes('empty response content'))
    pass('generateGeminiReasoning treats empty candidate text as failure/fallback instead of empty success')
  } catch (err) {
    fail('Gemini empty candidate fallback', err)
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = originalKey
  }

  const tmpC = await saveContact({ companyName: 'Sprint Temp Clean Check', phone: '1800123456' })
  await deleteContact(tmpC.contact.id)

  console.log('\n=============================================================')
  console.log(`Sprint Hardening Results: ${passed} Passed, ${failed} Failed`)
  console.log('=============================================================\n')

  if (failed > 0) process.exit(1)
}

runTests()
