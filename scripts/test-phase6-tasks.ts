import {
  saveTask,
  getTaskById,
  getAllTasks,
  updateTask,
  markTaskStatus,
  deleteTask,
  syncTasksFromLifeFile,
  handleDocumentDeleted,
  validateTaskId,
} from '../lib/tasks/storage.ts'
import {
  getOverdueTasks,
  getDueTodayTasks,
  getUpcomingTasks,
  getCompletedTasks,
  getTaskSummary,
} from '../lib/tasks/categorization.ts'
import { processTaskIntelligence } from '../lib/tasks/task-assistant.ts'
import { getReasoningReply } from '../lib/ai/reasoning-orchestrator.ts'
import type { StoredDocument } from '../lib/lifefile/types.ts'
import type { StoredTask } from '../lib/tasks/types.ts'

import fs from 'node:fs/promises'
import path from 'node:path'

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

async function runTests() {
  console.log('========================================================')
  console.log('📋 AURA Phase 6: Life Admin & Proactive Intelligence Tests')
  console.log('========================================================\n')

  // Clean test tasks state
  const tasksFile = path.resolve(process.cwd(), 'data', 'lifefile', 'tasks.json')
  await fs.unlink(tasksFile).catch(() => {})

  // Sample Documents with extracted deadlines
  const sampleBillDoc: StoredDocument = {
    id: 'doc_1700000001_p6bill',
    originalFilename: 'Adani_Power_Nov2026.pdf',
    storageFilename: 'doc_1700000001_p6bill.pdf',
    mimeType: 'application/pdf',
    fileSize: 250000,
    uploadTimestamp: '2026-11-01T10:00:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Bill',
      issuer: 'Adani Electricity',
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
      policyNumber: null,
      importantConditions: null,
      contactDetails: null,
      summary: 'Adani electricity bill due 25 Nov 2026',
    },
    extractionError: null,
  }

  const sampleInsuranceDoc: StoredDocument = {
    id: 'doc_1700000002_p6ins',
    originalFilename: 'HDFC_Ergo_Policy.pdf',
    storageFilename: 'doc_1700000002_p6ins.pdf',
    mimeType: 'application/pdf',
    fileSize: 350000,
    uploadTimestamp: '2026-10-15T10:00:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Insurance',
      issuer: 'HDFC Ergo',
      customerName: 'Ananya Kapoor',
      documentDate: '2025-12-30',
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
      policyNumber: 'HDFC-POL-9921',
      importantConditions: null,
      contactDetails: null,
      summary: 'HDFC health insurance policy renewal on 30 Dec 2026',
    },
    extractionError: null,
  }

  const sampleWarrantyDoc: StoredDocument = {
    id: 'doc_1700000003_p6war',
    originalFilename: 'MacBook_Air_Warranty.pdf',
    storageFilename: 'doc_1700000003_p6war.pdf',
    mimeType: 'application/pdf',
    fileSize: 180000,
    uploadTimestamp: '2026-11-02T10:00:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Warranty',
      issuer: 'Apple India',
      customerName: 'Ananya Kapoor',
      documentDate: '2025-11-20',
      dueDate: null,
      expiryDate: null,
      totalAmount: null,
      currency: null,
      productName: 'MacBook Air M2',
      modelNumber: 'A2681',
      serialNumber: 'C02TESTSER',
      purchaseDate: '2025-11-20',
      warrantyDuration: '2 Years',
      warrantyExpiry: '2027-11-20',
      policyNumber: null,
      importantConditions: null,
      contactDetails: null,
      summary: 'MacBook Air warranty card expiring 20 Nov 2027',
    },
    extractionError: null,
  }

  const sampleNoDateDoc: StoredDocument = {
    id: 'doc_1700000004_nodate',
    originalFilename: 'Gym_Brochure.pdf',
    storageFilename: 'doc_1700000004_nodate.pdf',
    mimeType: 'application/pdf',
    fileSize: 90000,
    uploadTimestamp: '2026-11-01T10:00:00.000Z',
    extractionStatus: 'completed',
    extractedData: {
      documentType: 'Other',
      issuer: 'Gold Gym',
      customerName: null,
      documentDate: null,
      dueDate: null, // null due date
      expiryDate: null, // null expiry
      totalAmount: null,
      currency: null,
      productName: null,
      modelNumber: null,
      serialNumber: null,
      purchaseDate: null,
      warrantyDuration: null,
      warrantyExpiry: null, // null warranty
      policyNumber: null,
      importantConditions: null,
      contactDetails: null,
      summary: 'General informational gym brochure without deadlines',
    },
    extractionError: null,
  }

  // 1. Automatic Task Creation from LifeFile Documents
  console.log('[1. Automatic Task Creation from Documents]')
  const docsToSync = [sampleBillDoc, sampleInsuranceDoc, sampleWarrantyDoc]
  const syncResult1 = await syncTasksFromLifeFile(docsToSync)
  console.log('  Debug syncResult1:', { added: syncResult1.added.length, skipped: syncResult1.skippedCount })
  assert(syncResult1.added.length === 3, 'Created exactly 3 tasks from 3 documents with deadlines', `Got ${syncResult1.added.length}`)

  const billTask = syncResult1.added.find((t) => t.category === 'bill')
  assert(billTask !== undefined, 'Bill task generated')
  assert(billTask?.title.includes('Adani') ?? false, 'Bill task title mentions Adani')
  assert(billTask?.dueDate === '2026-11-25', 'Bill task due date matches 2026-11-25')
  assert(billTask?.linkedDocumentId === sampleBillDoc.id, 'Bill task correctly linked to document ID')

  const insTask = syncResult1.added.find((t) => t.category === 'insurance')
  assert(insTask !== undefined, 'Insurance task generated')
  assert(insTask?.dueDate === '2026-12-30', 'Insurance task renewal date matches 2026-12-30')

  const warTask = syncResult1.added.find((t) => t.category === 'warranty')
  assert(warTask !== undefined, 'Warranty task generated')
  assert(warTask?.dueDate === '2027-11-20', 'Warranty task due date matches 2027-11-20')

  // 2. Duplicate Prevention
  console.log('\n[2. Duplicate Prevention on Resync]')
  const syncResult2 = await syncTasksFromLifeFile(docsToSync)
  assert(syncResult2.added.length === 0, 'Does not add duplicate tasks on resync')
  assert(syncResult2.skippedCount === 3, 'Correctly flags 3 existing tasks as skipped duplicates')

  // 3. Documents with Missing Due Dates
  console.log('\n[3. Documents with Missing Due Dates]')
  const syncResult3 = await syncTasksFromLifeFile([sampleNoDateDoc])
  assert(syncResult3.added.length === 0, 'Never invents tasks when dates are missing')

  // 4. Manual Task Creation
  console.log('\n[4. Manual Task Creation]')
  const manualTask = await saveTask({
    title: 'Schedule water purifier filter change',
    description: 'Call technician for Kent RO annual filter replacement',
    category: 'personal',
    dueDate: '2026-11-18',
    status: 'pending',
    priority: 'medium',
    linkedDocumentId: null,
    source: 'manual',
    reminder: {
      reminderDate: '2026-11-18',
      enabled: true,
      timezone: 'Asia/Kolkata',
    },
  })
  assert(validateTaskId(manualTask.id), 'Manual task has valid generated task ID')
  assert(manualTask.source === 'manual', 'Task source is marked as manual')
  assert(manualTask.reminder?.enabled === true, 'Reminder object stored correctly')

  // 5. Editing and Status Updates
  console.log('\n[5. Task Editing & Completion]')
  const updated = await updateTask(manualTask.id, {
    priority: 'high',
    description: 'Updated: Technician booked for morning slot',
  })
  assert(updated?.priority === 'high', 'Priority updated to high')
  assert(updated?.description.includes('morning slot') ?? false, 'Description updated')

  const completed = await markTaskStatus(manualTask.id, 'completed')
  assert(completed?.status === 'completed', 'Task status successfully updated to completed')

  // 6. Dismissal and Deletion
  console.log('\n[6. Task Dismissal & Deletion]')
  const toDismiss = await saveTask({
    title: 'Temporary task to dismiss',
    description: 'To be dismissed',
    category: 'general',
    dueDate: '2026-12-01',
    status: 'pending',
    priority: 'low',
    linkedDocumentId: null,
    source: 'manual',
  })
  const dismissed = await markTaskStatus(toDismiss.id, 'dismissed')
  assert(dismissed?.status === 'dismissed', 'Task marked as dismissed')

  const deleted = await deleteTask(toDismiss.id)
  assert(deleted === true, 'Task deleted from storage')
  const afterDelete = await getTaskById(toDismiss.id)
  assert(afterDelete === null, 'Deleted task cannot be retrieved')

  // 7. Categorization & Dashboard Metrics (using Nov 10, 2026 as reference)
  console.log('\n[7. Task Categorization & Dashboard Metrics]')
  const referenceDate = '2026-11-10'
  const testTasksList: StoredTask[] = [
    {
      id: 'task_overdue_1',
      title: 'Old Broadband Bill',
      description: 'Overdue bill',
      category: 'bill',
      dueDate: '2026-11-05', // overdue
      status: 'pending',
      priority: 'high',
      linkedDocumentId: null,
      source: 'manual',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
    {
      id: 'task_today_1',
      title: 'Car Service Appointment',
      description: 'Due today',
      category: 'personal',
      dueDate: '2026-11-10', // due today
      status: 'pending',
      priority: 'medium',
      linkedDocumentId: null,
      source: 'manual',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
    {
      id: 'task_upcoming_1',
      title: 'Electricity Bill',
      description: 'Upcoming',
      category: 'bill',
      dueDate: '2026-11-25', // upcoming
      status: 'pending',
      priority: 'high',
      linkedDocumentId: null,
      source: 'auto',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
    {
      id: 'task_completed_1',
      title: 'Paid Water Bill',
      description: 'Already paid',
      category: 'bill',
      dueDate: '2026-11-02',
      status: 'completed',
      priority: 'medium',
      linkedDocumentId: null,
      source: 'manual',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-02',
    },
  ]

  const overdueList = getOverdueTasks(testTasksList, referenceDate)
  assert(overdueList.length === 1 && overdueList[0].id === 'task_overdue_1', 'Identifies overdue tasks')

  const todayList = getDueTodayTasks(testTasksList, referenceDate)
  assert(todayList.length === 1 && todayList[0].id === 'task_today_1', 'Identifies tasks due today')

  const upcomingList = getUpcomingTasks(testTasksList, 30, referenceDate)
  assert(upcomingList.length === 1 && upcomingList[0].id === 'task_upcoming_1', 'Identifies upcoming tasks')

  const completedList = getCompletedTasks(testTasksList)
  assert(completedList.length === 1 && completedList[0].id === 'task_completed_1', 'Identifies completed tasks')

  const summary = getTaskSummary(testTasksList, referenceDate)
  assert(summary.overdue === 1, 'Summary calculates 1 overdue task')
  assert(summary.dueToday === 1, 'Summary calculates 1 due today task')
  assert(summary.upcoming === 1, 'Summary calculates 1 upcoming task')
  assert(summary.completed === 1, 'Summary calculates 1 completed task')

  // 8. Document Deletion Behavior: Safely unlinks without deleting manual tasks
  console.log('\n[8. Document Deletion Unlinking Behavior]')
  const unlinkedCount = await handleDocumentDeleted(sampleBillDoc.id)
  assert(unlinkedCount >= 1, 'Unlinks tasks pointing to deleted document')
  const allCurrent = await getAllTasks()
  const unlinkedBillTask = allCurrent.find((t) => t.id === billTask?.id)
  assert(unlinkedBillTask?.linkedDocumentId === null, 'Linked document ID is safely set to null')
  assert(unlinkedBillTask?.linkedDocumentName?.includes('(deleted)') ?? false, 'Linked document name flagged as deleted')

  // 9. Assistant Task Intelligence (Inquiry vs Action)
  console.log('\n[9. Assistant Task Inquiry Intelligence]')
  const inquiryRes = await processTaskIntelligence(
    'What tasks are overdue?',
    testTasksList,
    referenceDate
  )
  assert(inquiryRes.hasTaskIntent === true, 'Recognizes task inquiry intent')
  assert(inquiryRes.isAction === false, 'Flags inquiry as non-action')
  assert(inquiryRes.matchedTasks.length === 1, 'Returns the 1 overdue task')
  assert(inquiryRes.taskContext.includes('Old Broadband Bill'), 'Task context contains overdue task title')

  const weekRes = await processTaskIntelligence(
    'What bills are due this week?',
    testTasksList,
    referenceDate
  )
  assert(weekRes.hasTaskIntent === true, 'Recognizes due this week intent')

  // 10. Assistant Task Action Execution (Mark as completed)
  console.log('\n[10. Assistant Task Action Execution]')
  const actionRes = await processTaskIntelligence(
    'Mark my electricity bill task as completed',
    testTasksList,
    referenceDate
  )
  assert(actionRes.hasTaskIntent === true, 'Action query recognized')
  assert(actionRes.isAction === true, 'Identified as an action')
  assert(actionRes.actionExecuted === true, 'Executed action successfully')
  assert(actionRes.actionDetails?.newStatus === 'completed', 'New status is completed')

  // 11. Multilingual Hindi & Hinglish Task Inquiries
  console.log('\n[11. Multilingual Hindi / Hinglish Task Queries]')
  const hindiQueryRes = await processTaskIntelligence(
    'कौन से टास्क ओवरड्यू हैं?',
    testTasksList,
    referenceDate
  )
  assert(hindiQueryRes.hasTaskIntent === true, 'Devanagari query recognized for overdue tasks')

  const hinglishQueryRes = await processTaskIntelligence(
    'is hafte kaun se bill due hain',
    testTasksList,
    referenceDate
  )
  assert(hinglishQueryRes.hasTaskIntent === true, 'Hinglish query recognized for weekly bills')

  // 12. Security Validation for Task IDs
  console.log('\n[12. Task ID Security Validation]')
  assert(!validateTaskId('../../../etc/passwd'), 'Rejects path traversal in task ID')
  assert(!validateTaskId('task_invalid!chars'), 'Rejects invalid characters')
  assert(validateTaskId('task_1700000000_abcd1234'), 'Accepts valid task ID')

  // 13. Persistence Across Re-read
  console.log('\n[13. Storage Persistence Across Re-reads]')
  const tasksDisk = await getAllTasks()
  assert(Array.isArray(tasksDisk), 'Disk storage reads tasks successfully')
  assert(tasksDisk.length > 0, 'Persisted tasks exist on disk')

  // 14. Live Gemini Grounded Task Reasoning
  console.log('\n[14. Live Grounded Gemini Task Reasoning Test]')
  const apiKey = process.env.GEMINI_API_KEY
  if (apiKey) {
    try {
      console.log('  Testing live Gemini query for upcoming deadlines...')
      const liveTasksReply = await getReasoningReply({
        messages: [{ role: 'user', content: 'What tasks are overdue or due soon?' }],
        tasksOverride: testTasksList,
        referenceDate,
      })

      assert(liveTasksReply.success, 'Live Gemini answered task inquiry')
      assert(
        liveTasksReply.reply.includes('Old Broadband Bill') ||
        liveTasksReply.reply.includes('Broadband') ||
        liveTasksReply.reply.includes('overdue') ||
        liveTasksReply.reply.includes('Electricity Bill'),
        'AI cites verified task title and status from active storage'
      )
      console.log(`  Live Task Reply: "${liveTasksReply.reply}"`)

      console.log('  Testing live Gemini response for action execution...')
      const liveActionTasks: StoredTask[] = JSON.parse(JSON.stringify(testTasksList))
      const pendingElec = liveActionTasks.find((t) => t.id === 'task_upcoming_1')
      if (pendingElec) pendingElec.status = 'pending'

      const liveActionReply = await getReasoningReply({
        messages: [{ role: 'user', content: 'Mark my electricity bill task as completed' }],
        tasksOverride: liveActionTasks,
        referenceDate,
      })
      assert(liveActionReply.success, 'Live Gemini responded to action execution')
      assert(liveActionReply.actionExecuted === true, 'Action flag returned in response')
      assert(
        liveActionReply.reply.toLowerCase().includes('completed') ||
        liveActionReply.reply.toLowerCase().includes('done') ||
        liveActionReply.reply.toLowerCase().includes('mark'),
        'AI confirms task completion to user'
      )
      console.log(`  Live Action Reply: "${liveActionReply.reply}"`)
    } catch (err: any) {
      console.error('Live Gemini test failed:', err)
      failed++
    }
  } else {
    console.log('  ⚠️ GEMINI_API_KEY not configured, skipping live call.')
  }

  // Summary
  console.log('\n========================================================')
  console.log(`Phase 6 Test Results: ${passed} Passed, ${failed} Failed`)
  console.log('========================================================\n')

  if (failed > 0) process.exit(1)
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err)
  process.exit(1)
})
