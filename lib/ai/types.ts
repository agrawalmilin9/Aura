export type IndicLanguageCode =
  | 'hi-IN' // Hindi
  | 'en-IN' // Indian English
  | 'ta-IN' // Tamil
  | 'te-IN' // Telugu
  | 'kn-IN' // Kannada
  | 'mr-IN' // Marathi
  | 'bn-IN' // Bengali
  | 'gu-IN' // Gujarati
  | 'ml-IN' // Malayalam
  | 'pa-IN' // Punjabi
  | 'auto'  // Auto-detect (where supported)

export type STTFormat = 'verbatim' | 'transcribe'

export interface STTRequestOptions {
  audioBuffer: Buffer | Uint8Array | Blob
  mimeType?: string
  fileName?: string
  languageCode?: IndicLanguageCode
  model?: 'prisma-v2.5' | 'prisma-v3.0'
  format?: STTFormat
  itnNativeNumerals?: boolean
}

export interface STTResponse {
  success: boolean
  transcript: string
  detectedLanguageCode?: string
  model?: string
  requestId?: string
  processingTime?: number
  endToEndLatency?: number
  error?: string
}

export interface TTSRequestOptions {
  text: string
  languageCode?: IndicLanguageCode
  voice?: string
  model?: 'timbre-v2.5' | 'timbre-v3.0'
  speed?: number
  sampleRate?: number
}

export interface TTSResponse {
  success: boolean
  audioBuffer?: Buffer
  contentType?: string
  error?: string
}

export interface ReasoningMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface ReasoningRequestOptions {
  messages: ReasoningMessage[]
  temperature?: number
  maxTokens?: number
  languageCode?: IndicLanguageCode
  systemPrompt?: string
  documentsOverride?: any[]
  tasksOverride?: any[]
  productsOverride?: any[]
  contactsOverride?: any[]
  memoriesOverride?: any[]
  userProfileOverride?: {
    name?: string | null
    email?: string | null
    phone?: string | null
  }
  activeFormDocId?: string
  referenceDate?: string
  userId?: string
}

export interface DocumentSourceReference {
  documentId: string
  originalFilename: string
  documentType: string
  relevantField?: string
  fileUrl: string
}

export interface ReasoningResponse {
  success: boolean
  reply: string
  provider: 'evon' | 'gemini' | 'mock'
  sources?: DocumentSourceReference[]
  actionExecuted?: boolean
  isAmbiguous?: boolean
  noMatchFound?: boolean
  actionDetails?: {
    taskId: string
    title: string
    newStatus: string
  }
  memoryProposal?: {
    proposedContent: string
    category: string
    reason: string
  } | null
  formGuideDoc?: {
    documentId: string
    originalFilename: string
    formTitle: string | null
  } | null
  error?: string
}
