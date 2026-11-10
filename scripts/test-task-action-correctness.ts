import { processTaskIntelligence } from '../lib/tasks/task-assistant.ts'
import { getReasoningReply } from '../lib/ai/reasoning-orchestrator.ts'
import type { StoredTask } from '../lib/tasks/types.ts'

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

function cloneTasks(tasks: StoredTask[]): StoredTask[] {
  return JSON.parse(JSON.stringify(tasks))
}

async function runTests() {
  console.log('=================================================================')
  console.log('🎯 AURA Phase 6: Task Action Entity-Matching Correctness Suite')
  console.log('=================================================================\n')

  const baseTasks: StoredTask[] = [
    {
      id: 'task_elec_home',
      title: 'Adani Electricity Bill (Home)',
      description: '₹2,840 due on 2026-11-25',
      category: 'bill',
      dueDate: '2026-11-25',
      status: 'pending',
      priority: 'high',
      linkedDocumentId: 'doc_adani_1',
      linkedDocumentName: 'Adani_Electricity_Nov2026.pdf',
      source: 'auto',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
    {
      id: 'task_elec_office',
      title: 'Tata Power Electricity Bill (Office)',
      description: '₹4,120 due on 2026-11-28',
      category: 'bill',
      dueDate: '2026-11-28',
      status: 'pending',
      priority: 'medium',
      linkedDocumentId: 'doc_tata_1',
      linkedDocumentName: 'Tata_Power_Nov2026.pdf',
      source: 'auto',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
    {
      id: 'task_broadband',
      title: 'Airtel Xstream Fiber Broadband Bill',
      description: '₹1,179 due on 2026-11-15',
      category: 'bill',
      dueDate: '2026-11-15',
      status: 'pending',
      priority: 'high',
      linkedDocumentId: 'doc_airtel_1',
      linkedDocumentName: 'Airtel_Broadband_Nov2026.pdf',
      source: 'auto',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
    {
      id: 'task_water',
      title: 'Delhi Jal Board Water Bill',
      description: '₹480 due on 2026-11-22',
      category: 'bill',
      dueDate: '2026-11-22',
      status: 'pending',
      priority: 'low',
      linkedDocumentId: 'doc_djb_1',
      linkedDocumentName: 'DJB_Water_Nov2026.pdf',
      source: 'auto',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
    {
      id: 'task_water_service',
      title: 'Kent RO Water Purifier Service',
      description: 'Annual membrane change',
      category: 'personal',
      dueDate: '2026-11-18',
      status: 'pending',
      priority: 'medium',
      linkedDocumentId: null,
      source: 'manual',
      createdAt: '2026-11-01',
      updatedAt: '2026-11-01',
    },
  ]

  // 1. Exact Match: Broadband Bill (Must NEVER select Electricity or Water)
  console.log('[1. Exact Match - Broadband Bill]')
  const tasks1 = cloneTasks(baseTasks)
  const res1 = await processTaskIntelligence('Mark my broadband bill as completed', tasks1)
  assert(res1.actionExecuted === true, 'Action successfully executed for broadband bill')
  assert(res1.actionDetails?.taskId === 'task_broadband', 'Identified exact task ID (task_broadband)')
  assert(res1.actionDetails?.title === 'Airtel Xstream Fiber Broadband Bill', 'Identified exact broadband title')
  // Verify storage safety: Only broadband task modified
  const modified1 = tasks1.find((t) => t.id === 'task_broadband')
  const untouchedElec = tasks1.find((t) => t.id === 'task_elec_home')
  const untouchedWater = tasks1.find((t) => t.id === 'task_water')
  assert(modified1?.status === 'completed', 'Broadband task marked as completed in storage')
  assert(untouchedElec?.status === 'pending', 'Electricity bill remains pending (not touched)')
  assert(untouchedWater?.status === 'pending', 'Water bill remains pending (not touched)')

  // 2. Exact Match: Water Bill vs Water Purifier Service
  console.log('\n[2. Exact Match - Water Bill vs Water Purifier Service]')
  const tasks2 = cloneTasks(baseTasks)
  const res2 = await processTaskIntelligence('Mark water bill as done', tasks2)
  assert(res2.actionExecuted === true, 'Action executed for water bill')
  assert(res2.actionDetails?.taskId === 'task_water', 'Correctly picked Delhi Jal Board Water Bill, NOT Kent RO service')
  const roService = tasks2.find((t) => t.id === 'task_water_service')
  assert(roService?.status === 'pending', 'Kent RO purifier service remains pending')

  // 3. Ambiguity Detection: Multiple Electricity Bills
  console.log('\n[3. Ambiguity Detection - Multiple Electricity Bills]')
  const tasks3 = cloneTasks(baseTasks)
  const res3 = await processTaskIntelligence('Mark my electricity bill task as completed', tasks3)
  assert(res3.actionExecuted === false, 'Did NOT execute action when query is ambiguous')
  assert(res3.isAmbiguous === true, 'Correctly flagged as ambiguous')
  assert(res3.ambiguousTasks?.length === 2, 'Found exactly 2 candidate electricity bills')
  // Verify STORAGE SAFETY: Neither task status was modified!
  const elecHome = tasks3.find((t) => t.id === 'task_elec_home')
  const elecOffice = tasks3.find((t) => t.id === 'task_elec_office')
  assert(elecHome?.status === 'pending', 'Home electricity bill remains pending in storage')
  assert(elecOffice?.status === 'pending', 'Office electricity bill remains pending in storage')

  // 4. Disambiguated Query: Specific Electricity Bill (Adani)
  console.log('\n[4. Specific Disambiguated Query - Adani Electricity Bill]')
  const tasks4 = cloneTasks(baseTasks)
  const res4 = await processTaskIntelligence('Mark my Adani electricity bill as completed', tasks4)
  assert(res4.actionExecuted === true, 'Action executed when specific issuer is provided')
  assert(res4.actionDetails?.taskId === 'task_elec_home', 'Selected Adani bill specifically')
  const officeBill = tasks4.find((t) => t.id === 'task_elec_office')
  assert(officeBill?.status === 'pending', 'Office Tata Power bill remains pending')

  // 5. No Matching Task Found: Requesting a task that does not exist
  console.log('\n[5. No Matching Task Found]')
  const tasks5 = cloneTasks(baseTasks)
  const res5 = await processTaskIntelligence('Mark my gas cylinder booking task as completed', tasks5)
  assert(res5.actionExecuted === false, 'Action NOT executed for non-existent task')
  assert(res5.noMatchFound === true, 'Flagged as no match found')
  // Verify STORAGE SAFETY: All tasks remain pending
  assert(tasks5.every((t) => t.status === 'pending'), 'All tasks remain strictly untouched in storage')

  // 6. Cross-Domain Isolation: Asking for electricity when only broadband and water exist
  console.log('\n[6. Cross-Domain Negative Isolation]')
  const tasksWithoutElec = baseTasks.filter((t) => !t.title.includes('Electricity'))
  const res6 = await processTaskIntelligence('Mark my electricity bill as completed', tasksWithoutElec)
  assert(res6.actionExecuted === false, 'NEVER selects broadband or water when asked for electricity')
  assert(res6.noMatchFound === true, 'Correctly flags no matching electricity task')

  // 7. Multilingual Hindi Query (Devanagari)
  console.log('\n[7. Multilingual Devanagari Hindi Query]')
  const tasks7 = cloneTasks(baseTasks)
  const res7 = await processTaskIntelligence('ब्रॉडबैंड बिल का टास्क पूरा मार्क कर दो', tasks7)
  assert(res7.actionExecuted === true, 'Hindi command recognized action')
  assert(res7.actionDetails?.taskId === 'task_broadband', 'Hindi command selected correct broadband task')

  // 8. Multilingual Hinglish Query
  console.log('\n[8. Multilingual Hinglish Query]')
  const tasks8 = cloneTasks(baseTasks)
  const res8 = await processTaskIntelligence('mera water bill task done mark kar do', tasks8)
  assert(res8.actionExecuted === true, 'Hinglish command recognized action')
  assert(res8.actionDetails?.taskId === 'task_water', 'Hinglish command selected correct water bill')

  // 9. Requiring Explicit Action Intent (No modification on casual statement)
  console.log('\n[9. Explicit Intent Requirement]')
  const tasks9 = cloneTasks(baseTasks)
  const res9 = await processTaskIntelligence('I just paid my electricity bill today', tasks9)
  assert(res9.isAction === false, 'Statement without explicit action verb is NOT treated as an action')
  assert(res9.actionExecuted !== true, 'Did not execute action on casual statement')

  // 10. Live Gemini Integration: Grounded Action Confirmation & Ambiguity Handling
  console.log('\n[10. Live Gemini Action Correctness & Ambiguity Verification]')
  const apiKey = process.env.GEMINI_API_KEY
  if (apiKey) {
    try {
      console.log('  Testing live Gemini response for specific task completion...')
      const tasksLive1 = cloneTasks(baseTasks)
      const liveExactReply = await getReasoningReply({
        messages: [{ role: 'user', content: 'Mark my Adani electricity bill as completed' }],
        tasksOverride: tasksLive1,
      })

      assert(liveExactReply.success, 'Gemini responded to specific action')
      assert(liveExactReply.actionExecuted === true, 'Response carries actionExecuted=true')
      assert(liveExactReply.actionDetails?.title === 'Adani Electricity Bill (Home)', 'actionDetails has exact task title')
      assert(
        liveExactReply.reply.includes('Adani Electricity Bill (Home)') ||
        liveExactReply.reply.includes('Adani') ||
        liveExactReply.reply.includes('Electricity Bill'),
        'AI confirmation mentions exact Adani task, NOT Broadband or Water'
      )
      assert(!liveExactReply.reply.includes('Broadband'), 'Confirmation does NOT hallucinate Broadband')
      console.log(`  Live Confirmation: "${liveExactReply.reply}"`)

      console.log('  Testing live Gemini response for ambiguous command (multiple electricity bills)...')
      const tasksLive2 = cloneTasks(baseTasks)
      const liveAmbiguousReply = await getReasoningReply({
        messages: [{ role: 'user', content: 'Mark my electricity bill task as completed' }],
        tasksOverride: tasksLive2,
      })

      assert(liveAmbiguousReply.success, 'Gemini responded to ambiguous action')
      assert(liveAmbiguousReply.actionExecuted === false, 'Action was NOT executed due to ambiguity')
      assert(liveAmbiguousReply.isAmbiguous === true, 'isAmbiguous flag returned')
      assert(
        liveAmbiguousReply.reply.includes('Home') ||
        liveAmbiguousReply.reply.includes('Office') ||
        liveAmbiguousReply.reply.includes('Tata Power') ||
        liveAmbiguousReply.reply.includes('Adani') ||
        liveAmbiguousReply.reply.toLowerCase().includes('which'),
        'AI asks user to clarify between Home and Office bills'
      )
      console.log(`  Live Ambiguity Clarification: "${liveAmbiguousReply.reply}"`)

      console.log('  Testing live Gemini response for non-existent task...')
      const tasksLive3 = cloneTasks(baseTasks)
      const liveUnmatchedReply = await getReasoningReply({
        messages: [{ role: 'user', content: 'Mark my gas bill task as completed' }],
        tasksOverride: tasksLive3,
      })
      assert(liveUnmatchedReply.actionExecuted === false, 'Action NOT executed for missing gas bill')
      assert(
        liveUnmatchedReply.reply.toLowerCase().includes('no') ||
        liveUnmatchedReply.reply.toLowerCase().includes('not found') ||
        liveUnmatchedReply.reply.toLowerCase().includes('nahi mila') ||
        liveUnmatchedReply.reply.toLowerCase().includes("couldn't find"),
        'AI clearly states no matching gas bill was found'
      )
      console.log(`  Live Unmatched Explanation: "${liveUnmatchedReply.reply}"`)
    } catch (err: any) {
      console.error('Live Gemini test failed:', err)
      failed++
    }
  } else {
    console.log('  ⚠️ GEMINI_API_KEY not configured, skipping live call.')
  }

  // Summary
  console.log('\n=================================================================')
  console.log(`Task Action Correctness Results: ${passed} Passed, ${failed} Failed`)
  console.log('=================================================================\n')

  if (failed > 0) process.exit(1)
}

runTests().catch((err) => {
  console.error('Test runner crashed:', err)
  process.exit(1)
})
