import assert from 'node:assert'
import fs from 'node:fs'
import path from 'node:path'
import { getAuthSigningSecret, registerUserWithPassword, authenticateWithPassword, verifySessionToken, revokeSessionToken } from '../lib/auth/storage.ts'
import { assertValidPrivateBlobPathname, buildUserTempUploadPrefix } from '../lib/storage/blob-storage.ts'
import { CLIENT_BLOB_THRESHOLD_BYTES, MAX_UPLOAD_BYTES } from '../lib/lifefile/client-upload.ts'
import { isCloudStorageEnabled } from '../lib/storage/backend.ts'
import {
  saveDocument,
  getAllDocuments,
  getDocumentById,
  getDocumentFileBuffer,
  deleteDocument,
} from '../lib/lifefile/storage.ts'
import { saveTask, getAllTasks, deleteTask } from '../lib/tasks/storage.ts'
import { saveProduct, getAllProducts, deleteProduct } from '../lib/products/storage.ts'
import { saveContact, getAllContacts, deleteContact } from '../lib/contacts/storage.ts'
import { saveMemory, getAllMemories, deleteMemory } from '../lib/memory/storage.ts'

function pass(name: string) {
  console.log(`PASS: ${name}`)
}

async function run() {
  console.log('=== AURA Vercel Cloud & Production Readiness Verification Suite ===')

  const origEnv = { ...process.env }

  try {
    // 1. Production AUTH_SESSION_SECRET enforcement
    delete process.env.AUTH_SESSION_SECRET
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.BLOB_READ_WRITE_TOKEN
    ;(process.env as any).NODE_ENV = 'production'

    let threwSecretErr = false
    try {
      await getAuthSigningSecret()
    } catch (err: any) {
      threwSecretErr = /AUTH_SESSION_SECRET/.test(err?.message || '')
    }
    assert.strictEqual(threwSecretErr, true, 'Production must fail fast if AUTH_SESSION_SECRET is missing')

    process.env.AUTH_SESSION_SECRET = 'test_prod_secret_at_least_32_characters_long_1234'
    const resolvedSecret = await getAuthSigningSecret()
    assert.strictEqual(resolvedSecret, 'test_prod_secret_at_least_32_characters_long_1234')
    pass('1. Production AUTH_SESSION_SECRET fails fast when absent and works when configured')

    // 2. Large-file threshold & cross-user blob pathname isolation checks
    assert.ok(CLIENT_BLOB_THRESHOLD_BYTES < 4.5 * 1024 * 1024, 'Client threshold must stay under Vercel 4.5 MB limit')
    assert.strictEqual(MAX_UPLOAD_BYTES, 10 * 1024 * 1024, '10 MB max upload size preserved')

    const userA = 'usr_1700000010_aaaa1111'
    const userB = 'usr_1700000020_bbbb2222'
    const tmpA = `${buildUserTempUploadPrefix(userA)}1700000000_doc.pdf`
    assert.strictEqual(assertValidPrivateBlobPathname(tmpA, userA), tmpA)
    assert.throws(() => assertValidPrivateBlobPathname(tmpA, userB), /Unauthorized blob pathname/)
    assert.throws(() => assertValidPrivateBlobPathname(`users/${userA}/documents/../hack.pdf`, userA), /Invalid private blob pathname/)
    pass('2. Large-file threshold & cross-user temporary Private Blob isolation verified')

    // Restore original env before static audit checks
    for (const key of ['AUTH_SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BLOB_READ_WRITE_TOKEN', 'NODE_ENV']) {
      if (origEnv[key] === undefined) delete process.env[key]
      else process.env[key] = origEnv[key]
    }

    // 3. Static checks: API route auth, runtime/maxDuration, no server secrets in components, gitignore rules
    const sensitiveRoutes = [
      'app/api/documents/route.ts',
      'app/api/documents/preview/route.ts',
      'app/api/documents/blob-token/route.ts',
      'app/api/documents/[id]/route.ts',
      'app/api/documents/[id]/file/route.ts',
      'app/api/documents/[id]/extract/route.ts',
      'app/api/documents/[id]/form-guide/route.ts',
      'app/api/documents/[id]/filled-form/route.ts',
      'app/api/chat/route.ts',
      'app/api/voice/stt/route.ts',
      'app/api/voice/tts/route.ts',
      'app/api/tasks/route.ts',
      'app/api/tasks/[id]/route.ts',
      'app/api/products/route.ts',
      'app/api/products/[id]/route.ts',
      'app/api/contacts/route.ts',
      'app/api/contacts/[id]/route.ts',
      'app/api/memory/route.ts',
      'app/api/memory/[id]/route.ts',
      'app/api/lifefile/export/route.ts',
      'app/api/intelligence/route.ts',
    ]
    for (const rel of sensitiveRoutes) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
      assert.ok(src.includes('requireApiAuth'), `${rel} must call requireApiAuth`)
    }

    const runtimeRoutes = [
      'app/api/documents/route.ts',
      'app/api/documents/preview/route.ts',
      'app/api/documents/blob-token/route.ts',
      'app/api/documents/[id]/extract/route.ts',
      'app/api/documents/[id]/form-guide/route.ts',
      'app/api/documents/[id]/filled-form/route.ts',
      'app/api/chat/route.ts',
      'app/api/voice/stt/route.ts',
      'app/api/voice/tts/route.ts',
    ]
    for (const rel of runtimeRoutes) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8')
      assert.ok(src.includes("runtime = 'nodejs'"), `${rel} must configure nodejs runtime`)
      assert.ok(src.includes('maxDuration ='), `${rel} must configure maxDuration`)
    }

    // Ensure client components never reference server secrets
    const compFiles = fs.readdirSync(path.join(process.cwd(), 'components', 'aura'))
    for (const f of compFiles) {
      if (!f.endsWith('.tsx') && !f.endsWith('.ts')) continue
      const content = fs.readFileSync(path.join(process.cwd(), 'components', 'aura', f), 'utf-8')
      for (const secretKey of ['SUPABASE_SERVICE_ROLE_KEY', 'BLOB_READ_WRITE_TOKEN', 'AUTH_SESSION_SECRET', 'GEMINI_API_KEY', 'GNANI_API_KEY']) {
        assert.ok(!content.includes(secretKey), `Client component ${f} must not reference ${secretKey}`)
      }
    }

    // Ensure .gitignore blocks .env*, /data/, /.vercel
    const gitignore = fs.readFileSync(path.join(process.cwd(), '.gitignore'), 'utf-8')
    assert.ok(gitignore.includes('.env*'))
    assert.ok(gitignore.includes('/data/'))
    assert.ok(gitignore.includes('.vercel'))
    pass('3. Static security & deployment audit verified (auth guards, runtimes, zero leaked secrets, .gitignore)')

    // 4. Optional Live Supabase + Private Vercel Blob Integration Suite
    if (isCloudStorageEnabled()) {
      console.log('Running LIVE Supabase PostgreSQL + Private Vercel Blob end-to-end tests...')
      const emailA = `cloud_a_${Date.now()}@example.com`
      const emailB = `cloud_b_${Date.now()}@example.com`
      const pw = 'CloudSecretPass@2026'

      const signupA = await registerUserWithPassword({
        name: 'Cloud User A',
        email: emailA,
        password: pw,
        confirmPassword: pw,
      })
      assert.strictEqual(signupA.success, true)
      const uidA = signupA.user!.id
      const tokA = signupA.sessionToken!

      const signupB = await registerUserWithPassword({
        name: 'Cloud User B',
        email: emailB,
        password: pw,
        confirmPassword: pw,
      })
      assert.strictEqual(signupB.success, true)
      const uidB = signupB.user!.id

      const verifiedA = await verifySessionToken(tokA)
      assert.strictEqual(verifiedA?.id, uidA)

      const pdfBuf = Buffer.from('%PDF-1.4\n%Cloud Test PDF\n%%EOF', 'utf-8')
      const docA = await saveDocument(pdfBuf, 'cloud-test.pdf', 'application/pdf', uidA)
      assert.ok(docA.storageFilename.startsWith(`users/${uidA}/documents/`))

      const docsForA = await getAllDocuments(uidA)
      assert.strictEqual(docsForA.some((d) => d.id === docA.id), true)
      const docsForB = await getAllDocuments(uidB)
      assert.strictEqual(docsForB.some((d) => d.id === docA.id), false)
      assert.strictEqual(await getDocumentById(docA.id, uidB), null)
      assert.strictEqual(await getDocumentFileBuffer(docA.id, uidB), null)

      const readBackA = await getDocumentFileBuffer(docA.id, uidA)
      assert.ok(readBackA && readBackA.buffer.equals(pdfBuf))

      const taskA = await saveTask({
        title: 'Cloud Test Bill',
        description: 'Pay test bill',
        category: 'bill',
        dueDate: '2026-12-20',
        status: 'pending',
        priority: 'medium',
        linkedDocumentId: docA.id,
        source: 'manual',
      }, uidA)
      assert.strictEqual((await getAllTasks(uidB)).length, 0)

      const prodA = await saveProduct({ productName: 'Cloud AC', linkedDocumentIds: [docA.id], source: 'manual' }, uidA)
      assert.strictEqual((await getAllProducts(undefined, uidB)).length, 0)

      const contA = await saveContact({ companyName: 'Cloud Support', phone: '18001234567', linkedDocumentIds: [docA.id], source: 'manual' }, uidA)
      assert.strictEqual((await getAllContacts(uidB)).length, 0)

      const memA = await saveMemory({ content: 'Cloud user prefers email reminders', approvedByUser: true, category: 'preference' }, uidA)
      assert.strictEqual(memA.success, true)
      assert.strictEqual((await getAllMemories(uidB)).length, 0)

      // Clean up test records & private Blob
      await deleteTask(taskA.id, uidA)
      await deleteProduct(prodA.product.id, uidA)
      await deleteContact(contA.contact.id, uidA)
      if (memA.memory) await deleteMemory(memA.memory.id, uidA)
      await deleteDocument(docA.id, uidA)
      await revokeSessionToken(tokA)

      const loginCheck = await authenticateWithPassword({ email: emailA, password: pw })
      assert.strictEqual(loginCheck.success, true)
      pass('4. LIVE Supabase PostgreSQL + Private Vercel Blob integration & two-user isolation passed')
    } else {
      console.log('SKIPPED: Live Supabase PostgreSQL & Private Vercel Blob integration tests (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BLOB_READ_WRITE_TOKEN not set in env).')
    }
  } finally {
    for (const k of Object.keys(process.env)) {
      if (!(k in origEnv)) delete process.env[k]
    }
    Object.assign(process.env, origEnv)
  }

  console.log('VERCEL CLOUD READINESS SUITE COMPLETED!')
}

run().catch((err) => {
  console.error('READINESS SUITE FAILED:', err)
  process.exit(1)
})
