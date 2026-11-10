import type { ReasoningRequestOptions, ReasoningResponse } from './types.ts'
import { generateGeminiReasoning, AURA_SYSTEM_PROMPT } from './gemini/reasoning.ts'
import { generateEvonReasoning } from './evon/evon-client.ts'
import { getAllDocuments } from '../lifefile/storage.ts'
import { searchLifeFile, type RetrievalResult, type DocumentSourceReference } from '../lifefile/retrieval.ts'
import { processTaskIntelligence, type TaskAssistantResult } from '../tasks/task-assistant.ts'
import { getAllTasks } from '../tasks/storage.ts'
import { getAllProducts } from '../products/storage.ts'
import { getAllContacts } from '../contacts/storage.ts'
import { getAllMemories } from '../memory/storage.ts'
import {
  processConnectedIntelligence,
  type ConnectedIntelligenceResult,
} from '../intelligence/connected-intelligence.ts'
import {
  processFormIntelligence,
  type FormIntelligenceResult,
} from '../lifefile/form-assistant.ts'
import {
  needsFormFieldRecovery,
  recoverFormAnalysisForDocument,
} from '../lifefile/form-recovery.ts'
import type { StoredDocument } from '../lifefile/types.ts'
import type { StoredTask } from '../tasks/types.ts'
import type { StoredProduct } from '../products/types.ts'
import type { StoredContact } from '../contacts/types.ts'
import type { StoredMemory } from '../memory/types.ts'

export const DEMO_SAMPLE_NOTICE = `
NOTE ON SAMPLE SHOWCASE DATA:
If and only if the user explicitly inquires about the demo showcase profile (Ananya Kapoor) or sample examples:
- Sample Electricity Bill: Adani Electricity Bill (Oct 2026), ₹2,840 due 25 Nov 2026.
- Sample Health Policy: HDFC Ergo Health Policy, expires 30 Dec 2026.
- Sample Warranty: MacBook Air M2, Serial C02ZK0ABCDEF, expires 20 Nov 2027.
- Sample Appliance: LG Washing Machine, Serial LGWM-2303-8842, expires 15 Mar 2028.
Never use sample records to answer questions about the user's real uploaded documents or real tasks.
`

/**
 * Builds LifeFile-grounded instructions for Gemini/Evon based on actual uploaded documents and active tasks.
 */
function buildGroundedPrompt(
  baseSystemPrompt: string,
  query: string,
  retrieval: RetrievalResult,
  totalUploadedCount: number,
  taskResult: TaskAssistantResult,
  connectedResult: ConnectedIntelligenceResult,
  formResult?: FormIntelligenceResult
): string {
  let lifefileSection = ''
  let taskSection = ''
  let connectedSection = ''
  let formSection = ''
  let memorySection = ''

  // 1. LifeFile Document Grounding
  if (retrieval.hasMatches) {
    lifefileSection = `
GROUNDED CONTEXT FROM USER'S UPLOADED LIFEFILE DOCUMENTS:
The following verified records were retrieved from the user's uploaded LifeFile storage for query: "${query}"

${retrieval.groundedContext}

CRITICAL DOCUMENT GROUNDING INSTRUCTIONS:
1. Answer the user's question using ONLY the verified facts from the matched LifeFile document(s) above.
2. Always mention the source document name (e.g. "${retrieval.topMatch?.document.originalFilename}").
3. State extracted facts clearly (e.g., exact amount, due date, serial number, warranty expiry).
4. Never invent, hallucinate, or extrapolate missing values. If a requested detail (e.g. serial number or expiry) is not present or null, state clearly that it is not specified in the document.
5. Distinguish extracted facts from interpretations or suggestions.
6. Keep the answer direct, friendly, and concise (1 to 3 sentences maximum unless preparing a structured checklist or draft).
`
  } else if (connectedResult.isConnectedQuery || connectedResult.isAssistanceRequest) {
    lifefileSection = `
CONNECTED LIFEFILE STATUS:
Cross-module records (Products, Support Contacts, Linked Documents, and Tasks) have been retrieved below for query: "${query}".
`
  } else if (totalUploadedCount > 0) {
    lifefileSection = `
LIFEFILE SEARCH STATUS:
The user has ${totalUploadedCount} document(s) uploaded in their LifeFile, but NONE of them match the query: "${query}".

INSTRUCTIONS:
1. State clearly and politely that no matching document was found in their uploaded LifeFile for this query.
2. Mention what types of documents or categories they have if helpful, but never invent document details or fake facts.
3. Keep the answer concise (1 to 2 sentences).
`
  } else {
    lifefileSection = `
LIFEFILE SEARCH STATUS:
The user has not yet uploaded any real documents to their LifeFile.

INSTRUCTIONS:
1. If the user asks about their personal bills, warranties, insurance, or invoices, inform them that their LifeFile is currently empty and encourage them to upload their document in the Documents section.
2. Never present sample demonstration data as the user's personal documents.
${DEMO_SAMPLE_NOTICE}
3. Keep the answer concise (1 to 2 sentences).
`
  }

  // 2. Task & Deadline Grounding
  if (taskResult.hasTaskIntent) {
    if (taskResult.isAction && taskResult.actionExecuted) {
      taskSection = `
LIFE ADMIN ACTION EXECUTED:
The requested task action has already been performed in the task storage:
- Task ID: "${taskResult.actionDetails?.taskId}"
- Task Title: "${taskResult.actionDetails?.title}"
- New Status: ${taskResult.actionDetails?.newStatus}

ACTION CONFIRMATION INSTRUCTIONS:
1. Explicitly confirm to the user that the task "${taskResult.actionDetails?.title}" has been successfully marked as ${taskResult.actionDetails?.newStatus}.
2. Use the exact task title "${taskResult.actionDetails?.title}". Never guess or substitute a different title.
3. Be cheerful, direct, and concise (1 to 2 sentences).
`
    } else if (taskResult.isAction && taskResult.isAmbiguous) {
      taskSection = `
AMBIGUOUS TASK ACTION INTENT:
${taskResult.taskContext}

INSTRUCTIONS FOR AMBIGUOUS ACTION:
1. State politely that multiple pending tasks match the user's description.
2. List the matching tasks with their exact titles and due dates.
3. Ask the user to clarify which specific task they wish to update.
4. Do NOT claim any task was updated or completed.
`
    } else if (taskResult.isAction && taskResult.noMatchFound) {
      taskSection = `
FAILED TASK ACTION:
${taskResult.taskContext}

INSTRUCTIONS FOR UNMATCHED ACTION:
1. Clearly inform the user that no matching pending task was found in their Life Admin tasks.
2. Do NOT pretend any task was completed or guess an unrelated task.
3. Keep the response polite and concise (1 to 2 sentences).
`
    } else {
      taskSection = `
LIFE ADMIN TASKS & UPCOMING DEADLINES:
${taskResult.taskContext}

TASK INQUIRY INSTRUCTIONS:
1. Answer the user's inquiry about their tasks, bills due this week, upcoming renewals, or overdue deadlines using the task records listed above.
2. State exact dates, bill amounts, and priority levels.
3. If no tasks are due or overdue, let the user know clearly and politely.
4. Keep the response concise (1 to 3 sentences maximum).
`
    }
  }

  // 3. Connected Personal Intelligence (Products, Contacts, Linked Docs, Assistance Drafts)
  if (connectedResult.connectedContext) {
    connectedSection = `
${connectedResult.connectedContext}

CONNECTED INTELLIGENCE INSTRUCTIONS:
1. Use the connected records above to answer across Products, LifeFile Documents, Support Contacts, and Tasks accurately.
2. Always separate Verified Extracted Facts from Missing Information and AI Suggestions / Drafts.
3. Never auto-dial phone numbers or send emails — present drafts or contact details for user approval only.
`
  }

  // 4. User-Approved Personal Memory & Permission Proposal
  if (connectedResult.memoryContext || connectedResult.memoryProposal || connectedResult.memoryBlockedReason) {
    const parts: string[] = []
    if (connectedResult.memoryContext) {
      parts.push(connectedResult.memoryContext)
    }
    if (connectedResult.memoryBlockedReason) {
      parts.push(
        `MEMORY PRIVACY GUARD TRIGGERED:\n${connectedResult.memoryBlockedReason}\nExplain politely to the user that sensitive personal identifiers (passwords, PINs, card numbers, Aadhaar/PAN) cannot be stored in Personal Memory.`
      )
    } else if (connectedResult.memoryProposal) {
      parts.push(
        `PENDING MEMORY APPROVAL (NOT SAVED YET):\nThe user asked to remember: "${connectedResult.memoryProposal.proposedContent}" (Category: ${connectedResult.memoryProposal.category}).\nTell the user you have prepared this note for Personal Memory and ask them to click "Save to Memory" to confirm. Do NOT claim it is already saved.`
      )
    }
    memorySection = parts.join('\n\n')
  }

  // 5. AI Form Filling Guide & Supporting Field Prefill Intelligence
  if (formResult?.isFormQuery && formResult.groundedFormContext) {
    formSection = `
${formResult.groundedFormContext}

AI FORM FILLING GUIDE INSTRUCTIONS:
1. Override any default 1-3 sentence brevity limit whenever the user asks what to fill, asks for all fields, or asks for step-by-step guidance — explain EVERY detected field clearly without skipping fields.
2. For each field being explained, clearly present:
   - Field name (exact name from the form)
   - What it means (simple everyday language)
   - What to enter
   - Example (explicitly marked as a sample example, NEVER claim sample examples are real user facts)
   - Where to find it
   - Status: whether AURA found it in LifeFile (cite source document), needs confirmation (especially sensitive or ambiguous items), or needs user input / unclear in document.
3. Never invent values for unreadable, blurry, or missing fields. Never claim a form was submitted. Mention the interactive step-by-step Form Guide button when helpful.
`
  }

  return `${baseSystemPrompt}

${lifefileSection}

${taskSection}

${connectedSection}

${formSection}

${memorySection}

Language style:
- If query is in Hindi or Hinglish, answer in natural, respectful Hindi/Hinglish.
- If query is in English, answer in clear Indian English.
- Always be polite, helpful, and ${formResult?.isFormQuery ? 'thorough for every requested form field.' : 'concise.'}`
}

/**
 * Orchestrates grounded reasoning using LifeFile retrieval, Life Admin task intelligence, and active AI providers.
 */
export async function getReasoningReply(
  options: ReasoningRequestOptions
): Promise<ReasoningResponse> {
  const baseSystemPrompt = options.systemPrompt || AURA_SYSTEM_PROMPT

  // Extract latest user query from message history
  const lastUserMessage = [...options.messages].reverse().find((m) => m.role === 'user')
  const query = lastUserMessage?.content || ''

  // Retrieve stored documents, tasks, products, contacts, and approved memories (allow overrides for unit tests)
  let storedDocuments: StoredDocument[] = []
  let storedTasks: StoredTask[] = []
  let storedProducts: StoredProduct[] = []
  let storedContacts: StoredContact[] = []
  let storedMemories: StoredMemory[] = []

  try {
    storedDocuments = Array.isArray(options.documentsOverride)
      ? options.documentsOverride
      : await getAllDocuments(options.userId)
  } catch (err) {
    console.warn('Could not read LifeFile storage for reasoning:', err)
  }

  try {
    storedTasks = Array.isArray(options.tasksOverride)
      ? options.tasksOverride
      : await getAllTasks(options.userId)
    storedProducts = Array.isArray(options.productsOverride)
      ? options.productsOverride
      : await getAllProducts(options.referenceDate, options.userId)
    storedContacts = Array.isArray(options.contactsOverride)
      ? options.contactsOverride
      : await getAllContacts(options.userId)
    storedMemories = Array.isArray(options.memoriesOverride)
      ? options.memoriesOverride
      : await getAllMemories(options.userId)
  } catch (err) {
    console.warn('Could not read connected modules for reasoning:', err)
  }

  // Perform metadata-based retrieval against actual uploaded documents
  const retrieval = searchLifeFile(query, storedDocuments)

  // Perform Life Admin task intelligence (inquiry vs action)
  const taskResult = await processTaskIntelligence(
    query,
    options.tasksOverride,
    options.referenceDate,
    options.userId
  )

  // Perform Connected Personal Intelligence across Products, Contacts, Tasks, Documents & Memory
  const connectedResult = processConnectedIntelligence({
    query,
    documents: storedDocuments,
    products: storedProducts,
    contacts: storedContacts,
    tasks: storedTasks,
    memories: storedMemories,
    referenceDate: options.referenceDate,
  })

  // Evaluate AI Form Filling Guide context & cross-document prefills
  let formResult = processFormIntelligence({
    query,
    documents: storedDocuments,
    products: storedProducts,
    contacts: storedContacts,
    memories: storedMemories,
    userProfile: options.userProfileOverride,
    activeFormDocId: options.activeFormDocId,
  })

  // Auto-recover printed/scanned fields for blank PDF forms uploaded prior to multi-pass detection
  if (
    !options.documentsOverride &&
    formResult.targetFormDoc &&
    needsFormFieldRecovery(formResult.targetFormDoc)
  ) {
    try {
      const recovered = await recoverFormAnalysisForDocument(
        formResult.targetFormDoc,
        options.userId
      )
      if (recovered.id === formResult.targetFormDoc.id) {
        storedDocuments = storedDocuments.map((d) => (d.id === recovered.id ? recovered : d))
        formResult = processFormIntelligence({
          query,
          documents: storedDocuments,
          products: storedProducts,
          contacts: storedContacts,
          memories: storedMemories,
          userProfile: options.userProfileOverride,
          activeFormDocId: options.activeFormDocId,
        })
      }
    } catch (recErr) {
      console.warn('Form field auto-recovery skipped:', recErr)
    }
  }

  // Merge unique source citations across LifeFile retrieval, Connected Intelligence & Form Guide
  const mergedSourcesMap = new Map<string, DocumentSourceReference>()
  for (const s of [...retrieval.matchedSources, ...connectedResult.additionalSources, ...formResult.formSources]) {
    if (!mergedSourcesMap.has(s.documentId)) {
      mergedSourcesMap.set(s.documentId, s)
    }
  }
  const mergedSources = Array.from(mergedSourcesMap.values())

  // Ground system prompt with retrieved document context, tasks, connected data, form guide & memories
  const enrichedSystemPrompt = buildGroundedPrompt(
    baseSystemPrompt,
    query,
    retrieval,
    storedDocuments.length,
    taskResult,
    connectedResult,
    formResult
  )

  const enrichedOptions: ReasoningRequestOptions = {
    ...options,
    maxTokens: options.maxTokens ?? (formResult.isFormQuery ? 2048 : undefined),
    systemPrompt: enrichedSystemPrompt,
  }

  const formGuideDoc = formResult.targetFormDoc
    ? {
        documentId: formResult.targetFormDoc.id,
        originalFilename: formResult.targetFormDoc.originalFilename,
        formTitle:
          formResult.formState?.formTitle ||
          formResult.targetFormDoc.extractedData?.formAnalysis?.formTitle ||
          null,
      }
    : null

  // Check if Evon is explicitly enabled and configured
  if (process.env.USE_EVON === 'true' && process.env.EVON_BASE_URL) {
    const evonResult = await generateEvonReasoning(enrichedOptions)
    if (evonResult.success) {
      return {
        ...evonResult,
        sources: mergedSources,
        actionExecuted: taskResult.actionExecuted,
        isAmbiguous: taskResult.isAmbiguous,
        noMatchFound: taskResult.noMatchFound,
        actionDetails: taskResult.actionDetails,
        memoryProposal: connectedResult.memoryProposal,
        formGuideDoc,
      }
    }
    console.warn('Evon reasoning failed, falling back to Gemini:', evonResult.error)
  }

  // Default to Gemini reasoning
  const geminiResult = await generateGeminiReasoning(enrichedOptions)
  if (geminiResult.success) {
    return {
      ...geminiResult,
      sources: mergedSources,
      actionExecuted: taskResult.actionExecuted,
      isAmbiguous: taskResult.isAmbiguous,
      noMatchFound: taskResult.noMatchFound,
      actionDetails: taskResult.actionDetails,
      memoryProposal: connectedResult.memoryProposal,
      formGuideDoc,
    }
  }

  return geminiResult
}
