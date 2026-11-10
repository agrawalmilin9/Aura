import type { StoredTask, TaskStatus } from './types.ts'
import {
  getAllTasks,
  markTaskStatus,
} from './storage.ts'
import {
  getOverdueTasks,
  getDueTodayTasks,
  getUpcomingTasks,
  normalizeDate,
} from './categorization.ts'

export interface TaskAssistantResult {
  hasTaskIntent: boolean
  isAction: boolean
  actionExecuted?: boolean
  isAmbiguous?: boolean
  noMatchFound?: boolean
  actionDetails?: {
    taskId: string
    title: string
    newStatus: TaskStatus
  }
  ambiguousTasks?: StoredTask[]
  taskContext: string
  matchedTasks: StoredTask[]
}

const TASK_INQUIRY_KEYWORDS = [
  'task', 'tasks', 'todo', 'to do', 'due', 'due this week', 'overdue', 'upcoming',
  'renewals', 'deadlines', 'agenda', 'reminders', 'schedule',
  'टास्क', 'काम', 'बाकी', 'अंतिम तारीख', 'ओवरड्यू', 'इस हफ्ते', 'रिन्यूअल', 'शेड्यूल'
]

// Distinct entity subject groupings to prevent cross-domain contamination
const ENTITY_DOMAINS: Record<string, string[]> = {
  electricity: ['electricity', 'bijli', 'power', 'बिजली', 'इलेक्ट्रिसिटी', 'adani', 'अडानी', 'bescom', 'tata power', 'mahadiscom'],
  broadband: ['broadband', 'internet', 'wifi', 'fiber', 'airtel', 'jio', 'act', 'ब्रॉडबैंड', 'इंटरनेट', 'वाईफाई'],
  water: ['water', 'pani', 'jal', 'पानी', 'जल', 'जल बोर्ड', 'jal board'],
  gas: ['gas', 'lpg', 'cylinder', 'गैस', 'सिलेंडर', 'png', 'indane', 'hp gas', 'bharat gas'],
  insurance: ['insurance', 'policy', 'bima', 'beema', 'बीमा', 'पॉलिसी', 'hdfc', 'ergo', 'lic', 'mediclaim', 'health insurance'],
  warranty: ['warranty', 'guarantee', 'वारंटी', 'गारंटी', 'macbook', 'apple', 'laptop', 'washing machine', 'lg'],
  service: ['service', 'repair', 'filter', 'kent', 'ro', 'car service', 'सर्विस', 'मरम्मत'],
}

// Brand and location qualifiers for fine-grained disambiguation
const SPECIFIC_BRANDS: Record<string, string[]> = {
  adani: ['adani', 'अडानी'],
  tata: ['tata', 'टाटा'],
  airtel: ['airtel', 'एयरटेल'],
  jio: ['jio', 'जियो'],
  djb: ['djb', 'delhi jal board', 'दिल्ली जल बोर्ड', 'जल बोर्ड'],
  kent: ['kent', 'केंट'],
  apple: ['apple', 'macbook', 'एप्पल', 'मैकबुक'],
  lg: ['lg', 'एलजी'],
  home: ['home', 'ghar', 'घर'],
  office: ['office', 'daftar', 'दफ्तर', 'ऑफिस'],
}

// Multilingual word normalization
const HINDI_TRANSLITERATIONS: Record<string, string> = {
  'बिजली': 'electricity bijli',
  'पानी': 'water',
  'ब्रॉडबैंड': 'broadband internet',
  'इंटरनेट': 'internet broadband',
  'बीमा': 'insurance policy',
  'पॉलिसी': 'policy insurance',
  'वारंटी': 'warranty',
  'बिल': 'bill',
  'टास्क': 'task',
  'काम': 'task',
  'पूरा': 'complete completed',
  'डन': 'done completed',
  'खारिज': 'dismiss dismissed',
  'खत्म': 'complete done',
}

/**
 * Normalizes text and expands transliterations.
 */
function norm(text: string): string {
  let cleaned = text.toLowerCase().replace(/[^\w\s\u0900-\u097F]/g, ' ').replace(/\s+/g, ' ').trim()
  for (const [hindi, eng] of Object.entries(HINDI_TRANSLITERATIONS)) {
    if (cleaned.includes(hindi)) {
      cleaned += ` ${eng}`
    }
  }
  return cleaned
}

/**
 * Determines which domain(s) an entity text belongs to.
 */
function getMatchingDomains(text: string): string[] {
  const normText = norm(text)
  const matched: string[] = []
  for (const [domain, keywords] of Object.entries(ENTITY_DOMAINS)) {
    if (keywords.some((kw) => normText.includes(kw))) {
      matched.push(domain)
    }
  }
  return matched
}

/**
 * Evaluates whether a user query involves Life Admin tasks and executes actions with strict intent & entity validation.
 */
export async function processTaskIntelligence(
  query: string,
  tasksOverride?: StoredTask[],
  referenceDate?: string,
  userId?: string
): Promise<TaskAssistantResult> {
  const normQuery = norm(query)
  const refDate = normalizeDate(referenceDate)

  const allTasks: StoredTask[] = tasksOverride || (await getAllTasks(userId))

  // 1. Detect Action Intent: Mark Complete or Dismiss
  const hasCompleteVerb =
    (normQuery.includes('mark') && (normQuery.includes('complete') || normQuery.includes('completed') || normQuery.includes('done'))) ||
    normQuery.includes('complete task') ||
    normQuery.includes('task completed') ||
    normQuery.includes('डन') ||
    normQuery.includes('पूरा मार्क') ||
    normQuery.includes('कम्पलीट') ||
    normQuery.includes('काम हो गया')

  const hasDismissVerb =
    normQuery.includes('dismiss') ||
    normQuery.includes('cancel task') ||
    normQuery.includes('remove task') ||
    normQuery.includes('खारिज') ||
    normQuery.includes('हटा दो')

  if (hasCompleteVerb || hasDismissVerb) {
    const targetStatus: TaskStatus = hasCompleteVerb ? 'completed' : 'dismissed'

    // Extract query entity domains (e.g. 'electricity', 'broadband', 'water', etc.)
    const queryDomains = getMatchingDomains(normQuery)
    const queryTokens = normQuery
      .split(' ')
      .filter((t) => t.length > 2 && !['mark', 'the', 'task', 'completed', 'complete', 'done', 'dismiss', 'please', 'kripya', 'mera', 'meri', 'mere', 'aur', 'kar', 'do', 'dein'].includes(t))

    // Filter to currently pending tasks
    const pendingTasks = allTasks.filter((t) => t.status === 'pending')

    // Score and rank pending tasks against the action query
    const qualifiedMatches: Array<{ task: StoredTask; score: number }> = []

    for (const t of pendingTasks) {
      const taskText = t.title + ' ' + t.description + ' ' + (t.linkedDocumentName || '')
      const taskDomains = getMatchingDomains(taskText)
      const normTitle = norm(t.title)
      const titleTokens = normTitle.split(' ').filter((tk) => tk.length > 2)

      // CRITICAL CHECK 1: Incompatible Domain Gatekeeper
      // If query specifically asks for 'electricity' and task domain is 'broadband' (or vice-versa), REJECT immediately!
      if (queryDomains.length > 0 && taskDomains.length > 0) {
        const hasDomainOverlap = queryDomains.some((d) => taskDomains.includes(d))
        if (!hasDomainOverlap) {
          continue
        }
      }

      // CRITICAL CHECK 2: Brand / Location Specificity Gatekeeper
      // If query mentions a specific brand/location (e.g. 'adani') and task mentions a conflicting brand (e.g. 'tata'), REJECT!
      let hasBrandMatch = false
      let hasBrandConflict = false

      for (const [brandKey, brandKeywords] of Object.entries(SPECIFIC_BRANDS)) {
        const queryHasBrand = brandKeywords.some((bk) => normQuery.includes(bk))
        if (queryHasBrand) {
          const taskHasBrand = brandKeywords.some((bk) => norm(taskText).includes(bk))
          if (taskHasBrand) {
            hasBrandMatch = true
          } else {
            // Check if task explicitly carries a conflicting brand from another key
            for (const [otherKey, otherKeywords] of Object.entries(SPECIFIC_BRANDS)) {
              if (otherKey !== brandKey && otherKeywords.some((obk) => norm(taskText).includes(obk))) {
                hasBrandConflict = true
                break
              }
            }
          }
        }
      }

      if (hasBrandConflict) {
        continue // Disqualify conflicting brand
      }

      let score = 0

      // Exact domain match boost (e.g. both are electricity)
      if (queryDomains.length > 0 && taskDomains.length > 0) {
        if (queryDomains.some((d) => taskDomains.includes(d))) {
          score += 50
        }
      }

      // Specific brand/location match boost
      if (hasBrandMatch) {
        score += 60
      }

      // Title tokens overlap
      for (const token of titleTokens) {
        if (queryTokens.includes(token)) {
          score += 20
        }
      }

      // Category match
      if (norm(t.category) && normQuery.includes(norm(t.category))) {
        score += 10
      }

      // Linked document overlap
      if (t.linkedDocumentName && normQuery.includes(norm(t.linkedDocumentName))) {
        score += 30
      }

      // Threshold: Must have substantial domain or title match (score >= 40)
      if (score >= 40) {
        qualifiedMatches.push({ task: t, score })
      }
    }

    // Sort qualified matches descending by score
    qualifiedMatches.sort((a, b) => b.score - a.score)

    // CASE A: Exactly 1 unambiguous match
    if (qualifiedMatches.length === 1) {
      const bestMatch = qualifiedMatches[0].task

      // Execute status update in storage (or in override mock)
      if (!tasksOverride) {
        await markTaskStatus(bestMatch.id, targetStatus, userId)
      } else {
        bestMatch.status = targetStatus
      }

      return {
        hasTaskIntent: true,
        isAction: true,
        actionExecuted: true,
        actionDetails: {
          taskId: bestMatch.id,
          title: bestMatch.title,
          newStatus: targetStatus,
        },
        taskContext: `ACTION EXECUTED: Task "${bestMatch.title}" (ID: ${bestMatch.id}, Due: ${bestMatch.dueDate}) has been marked as ${targetStatus}.`,
        matchedTasks: [bestMatch],
      }
    }

    // CASE B: Multiple matches - Check if winner is clearly ahead or genuinely ambiguous
    if (qualifiedMatches.length > 1) {
      // If top match is substantially ahead of second match (>= 15 points gap), it is unambiguous!
      if (qualifiedMatches[0].score >= qualifiedMatches[1].score + 15) {
        const bestMatch = qualifiedMatches[0].task
        if (!tasksOverride) {
          await markTaskStatus(bestMatch.id, targetStatus, userId)
        } else {
          bestMatch.status = targetStatus
        }
        return {
          hasTaskIntent: true,
          isAction: true,
          actionExecuted: true,
          actionDetails: {
            taskId: bestMatch.id,
            title: bestMatch.title,
            newStatus: targetStatus,
          },
          taskContext: `ACTION EXECUTED: Task "${bestMatch.title}" (ID: ${bestMatch.id}, Due: ${bestMatch.dueDate}) has been marked as ${targetStatus}.`,
          matchedTasks: [bestMatch],
        }
      }

      // Ambiguity: Multiple tasks are tied or very close! DO NOT MODIFY STORAGE!
      const matched = qualifiedMatches.map((m) => m.task)
      const taskListStr = matched.map((t, i) => `${i + 1}. "${t.title}" (Due: ${t.dueDate})`).join(', ')

      return {
        hasTaskIntent: true,
        isAction: true,
        actionExecuted: false,
        isAmbiguous: true,
        ambiguousTasks: matched,
        taskContext: `AMBIGUOUS ACTION INTENT: The user requested to mark a task as ${targetStatus}, but multiple pending tasks match this description: ${taskListStr}. Do NOT modify any task. Ask the user which specific task they wish to update.`,
        matchedTasks: matched,
      }
    }

    // CASE C: No matching task found
    return {
      hasTaskIntent: true,
      isAction: true,
      actionExecuted: false,
      noMatchFound: true,
      taskContext: `TASK ACTION FAILED: No pending task matching "${query}" was found in active Life Admin tasks. Explain clearly to the user that no matching task was found, and list the active pending tasks if helpful. Do NOT claim any task was completed.`,
      matchedTasks: [],
    }
  }

  // 2. Detect Task Inquiry Intent
  const hasInquiryKeyword = TASK_INQUIRY_KEYWORDS.some((kw) => normQuery.includes(kw))
  const isDueThisWeekQuery = normQuery.includes('due this week') || normQuery.includes('this week') || normQuery.includes('इस हफ्ते')
  const isOverdueQuery = normQuery.includes('overdue') || normQuery.includes('बाकी') || normQuery.includes('ओवरड्यू')
  const isRenewalsQuery = normQuery.includes('renewal') || normQuery.includes('renewals') || normQuery.includes('रिन्यू')

  if (hasInquiryKeyword || isDueThisWeekQuery || isOverdueQuery || isRenewalsQuery) {
    let relevantTasks: StoredTask[] = []

    if (isOverdueQuery) {
      relevantTasks = getOverdueTasks(allTasks, refDate)
    } else if (isDueThisWeekQuery) {
      relevantTasks = getUpcomingTasks(allTasks, 7, refDate)
    } else if (isRenewalsQuery) {
      relevantTasks = allTasks.filter(
        (t) => (t.category === 'insurance' || t.category === 'warranty' || t.category === 'subscription') && t.status === 'pending'
      )
    } else {
      // General tasks inquiry
      const overdue = getOverdueTasks(allTasks, refDate)
      const today = getDueTodayTasks(allTasks, refDate)
      const upcoming = getUpcomingTasks(allTasks, 14, refDate)
      relevantTasks = [...overdue, ...today, ...upcoming]
    }

    let taskContext = ''
    if (relevantTasks.length > 0) {
      const lines = relevantTasks.slice(0, 5).map((t, i) => {
        const isOverdue = t.dueDate < refDate
        const timing = isOverdue ? `(OVERDUE - due ${t.dueDate})` : `(Due: ${t.dueDate})`
        return `${i + 1}. [${t.category.toUpperCase()}] "${t.title}" ${timing} - Priority: ${t.priority}. ${t.description}`
      })
      taskContext = `CURRENT LIFE ADMIN TASKS & DEADLINES (Reference Date: ${refDate}):\n${lines.join('\n')}`
    } else {
      taskContext = `CURRENT LIFE ADMIN TASKS & DEADLINES (Reference Date: ${refDate}):\nNo pending tasks found for this timeframe or query.`
    }

    return {
      hasTaskIntent: true,
      isAction: false,
      taskContext,
      matchedTasks: relevantTasks,
    }
  }

  return {
    hasTaskIntent: false,
    isAction: false,
    taskContext: '',
    matchedTasks: [],
  }
}
