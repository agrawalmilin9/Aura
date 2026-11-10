export type StorageBackendMode = 'local' | 'cloud'

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.SUPABASE_URL?.trim() &&
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  )
}

export function isVercelBlobConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim())
}

export function isVercelDeployment(): boolean {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV?.trim())
}

export function isCloudStorageEnabled(): boolean {
  return isSupabaseConfigured() && isVercelBlobConfigured()
}

/**
 * Resolves the active storage backend mode:
 * - 'local': Uses existing JSON/filesystem storage under data/ for offline dev & unit tests.
 * - 'cloud': Uses Supabase PostgreSQL + Private Vercel Blob in production/Vercel.
 */
export function getStorageBackendMode(): StorageBackendMode {
  const hasSupa = isSupabaseConfigured()
  const hasBlob = isVercelBlobConfigured()

  if (hasSupa && hasBlob) {
    return 'cloud'
  }

  if (hasSupa !== hasBlob) {
    throw new Error(
      'Incomplete cloud storage configuration: both Supabase (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) and Private Vercel Blob (BLOB_READ_WRITE_TOKEN) must be configured together.'
    )
  }

  if (isVercelDeployment()) {
    throw new Error(
      'Local filesystem storage is disabled on Vercel deployments. Configure SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and BLOB_READ_WRITE_TOKEN.'
    )
  }

  return 'local'
}
