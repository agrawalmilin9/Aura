import path from 'node:path'

const ROOT_DATA_DIR = path.resolve(process.cwd(), 'data')
const LEGACY_DATA_DIR = path.resolve(ROOT_DATA_DIR, 'lifefile')
const USERS_DATA_DIR = path.resolve(ROOT_DATA_DIR, 'users')
const USER_ID_REGEX = /^usr_[0-9]+_[a-f0-9]+$/

export function validateUserId(userId: string): boolean {
  return USER_ID_REGEX.test(userId)
}

/**
 * Resolves the isolated storage directory for a given userId, or the legacy shared/test directory
 * ONLY when called without userId from internal offline/unit test helpers.
 */
export function resolveScopedBaseDir(userId?: string): string {
  if (!userId) {
    return LEGACY_DATA_DIR
  }
  if (!validateUserId(userId)) {
    throw new Error('Invalid user scope identifier.')
  }
  const dir = path.resolve(USERS_DATA_DIR, userId)
  if (!dir.startsWith(USERS_DATA_DIR + path.sep)) {
    throw new Error('Path traversal detected in user directory resolution.')
  }
  return dir
}

export function resolveScopedDocumentsDir(userId?: string): string {
  const baseDir = resolveScopedBaseDir(userId)
  return path.resolve(baseDir, 'documents')
}

export function resolveScopedJsonFile(filename: string, userId?: string): string {
  const baseDir = resolveScopedBaseDir(userId)
  const resolved = path.resolve(baseDir, filename)
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid scoped file path.')
  }
  return resolved
}
