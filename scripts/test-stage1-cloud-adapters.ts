import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { getStorageBackendMode, isCloudStorageEnabled } from '../lib/storage/backend.ts'
import { getSupabaseAdmin } from '../lib/storage/supabase-client.ts'
import {
  assertValidPrivateBlobPathname,
  buildUserDocumentBlobPathname,
  buildUserTempUploadPrefix,
} from '../lib/storage/blob-storage.ts'

function pass(name: string) {
  console.log(`PASS: ${name}`)
}

async function run() {
  console.log('=== Stage 1 Vercel & Cloud Adapter Verification Suite ===')

  const origEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  }

  try {
    // 1. Local mode check (default when cloud env vars are absent)
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.BLOB_READ_WRITE_TOKEN
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV

    assert.strictEqual(isCloudStorageEnabled(), false)
    assert.strictEqual(getStorageBackendMode(), 'local')
    assert.throws(() => getSupabaseAdmin(), /SUPABASE_URL/)
    pass('1. Local dev falls back cleanly to local storage mode and fails fast on missing Supabase client creds')

    // 2. Partial cloud config & Vercel without cloud guards
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    assert.throws(() => getStorageBackendMode(), /Incomplete cloud storage configuration/)

    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.VERCEL = '1'
    assert.throws(() => getStorageBackendMode(), /Local filesystem storage is disabled on Vercel/)

    // Full cloud config detection
    process.env.SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_test'
    assert.strictEqual(isCloudStorageEnabled(), true)
    assert.strictEqual(getStorageBackendMode(), 'cloud')
    const client = getSupabaseAdmin()
    assert.ok(client, 'getSupabaseAdmin returns Supabase client instance')
    pass('2. Cloud mode detection, partial-config guard, and Vercel read-only filesystem guard verified')

    // 3. Private Blob user-isolation & traversal checks
    const userA = 'usr_1700000001_aaaa1111'
    const userB = 'usr_1700000002_bbbb2222'
    const safeBlobPath = buildUserDocumentBlobPathname(userA, 'doc_1700000001_aaaa1111.pdf')
    assert.strictEqual(safeBlobPath, `users/${userA}/documents/doc_1700000001_aaaa1111.pdf`)
    assert.strictEqual(buildUserTempUploadPrefix(userA), `uploads/tmp/${userA}/`)

    assert.strictEqual(assertValidPrivateBlobPathname(safeBlobPath, userA), safeBlobPath)
    assert.throws(() => assertValidPrivateBlobPathname(safeBlobPath, userB), /Unauthorized blob pathname/)
    assert.throws(() => buildUserDocumentBlobPathname(userA, '../secret.pdf'), /Unsafe storage filename/)
    assert.throws(() => assertValidPrivateBlobPathname('https://public-blob.example/doc.pdf', userA), /Invalid private blob pathname/)
    assert.throws(() => assertValidPrivateBlobPathname(`users/${userA}/documents/../other.pdf`, userA), /Invalid private blob pathname/)
    pass('3. Private Blob pathname isolation blocks cross-user access, path traversal, and external URLs')

    // 4. Schema completeness check
    const schemaPath = path.join(process.cwd(), 'supabase', 'schema.sql')
    assert.ok(fs.existsSync(schemaPath), 'supabase/schema.sql must exist')
    const sql = fs.readFileSync(schemaPath, 'utf-8')
    const expectedTables = [
      'aura_users',
      'aura_sessions',
      'aura_rate_limits',
      'aura_documents',
      'aura_tasks',
      'aura_products',
      'aura_contacts',
      'aura_memories',
    ]
    for (const t of expectedTables) {
      assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${t}`), `Missing table ${t} in schema.sql`)
      assert.ok(sql.includes(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`), `Missing RLS lock on ${t}`)
    }
    pass('4. Supabase PostgreSQL schema defines all 8 tables with RLS enabled')
  } finally {
    for (const [k, v] of Object.entries(origEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }

  console.log('STAGE 1 ADAPTER & SCHEMA TESTS PASSED!')
}

run().catch((err) => {
  console.error('STAGE 1 TEST FAILED:', err)
  process.exit(1)
})
