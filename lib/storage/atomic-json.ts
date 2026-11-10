import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const fileLocks = new Map<string, Promise<unknown>>()

/**
 * Serializes asynchronous read-modify-write operations per JSON file path
 * to prevent concurrent API requests from overwriting one another.
 */
export async function withFileLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const resolved = path.resolve(filePath)
  const previous = fileLocks.get(resolved) ?? Promise.resolve()

  let release!: () => void
  const current = new Promise<void>((res) => {
    release = res
  })

  const chain = previous.then(() => current, () => current)
  fileLocks.set(resolved, chain)

  await previous.catch(() => {})
  try {
    return await task()
  } finally {
    release()
    if (fileLocks.get(resolved) === chain) {
      fileLocks.delete(resolved)
    }
  }
}

/**
 * Ensures directory exists and writes JSON atomically using a collision-free temp file.
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath)
  if (!fsSync.existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true })
  }
  const uniqueSuffix = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  const tempFile = `${filePath}.tmp_${uniqueSuffix}`
  const content = JSON.stringify(data, null, 2)
  await fs.writeFile(tempFile, content, 'utf-8')
  await fs.rename(tempFile, filePath)
}

/**
 * Safely reads and parses a JSON dictionary file, returning fallback on missing or corrupt content.
 */
export async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    if (!fsSync.existsSync(filePath)) {
      return fallback
    }
    const raw = await fs.readFile(filePath, 'utf-8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw) as T
  } catch (err) {
    console.warn(`Warning: Failed to read ${path.basename(filePath)}, using fallback:`, err)
    return fallback
  }
}
