import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cachedClient: SupabaseClient | null = null
let cachedKey = ''

/**
 * Returns a server-only Supabase admin client authenticated with SUPABASE_SERVICE_ROLE_KEY.
 * Never call from browser/client components.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !serviceKey) {
    throw new Error(
      'Supabase server credentials (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) are not configured.'
    )
  }

  const cacheSignature = `${url}::${serviceKey.length}`
  if (cachedClient && cachedKey === cacheSignature) {
    return cachedClient
  }

  cachedClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  cachedKey = cacheSignature
  return cachedClient
}

/**
 * Unwraps a Supabase PostgREST response safely without leaking credentials in error messages.
 */
export function unwrapSupabaseResult<T>(
  result: { data: T | null; error: { message?: string; code?: string } | null },
  operation: string
): T {
  if (result.error) {
    throw new Error(`Database error during ${operation}: ${result.error.message || 'Unknown error'}`)
  }
  if (result.data === null) {
    throw new Error(`Database returned null unexpectedly during ${operation}.`)
  }
  return result.data
}
