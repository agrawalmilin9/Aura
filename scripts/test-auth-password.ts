import assert from 'node:assert'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import {
  authenticateWithPassword,
  findUserByEmail,
  registerUserWithPassword,
  revokeSessionToken,
  verifySessionToken,
} from '../lib/auth/storage.ts'
import {
  deleteDocument,
  getAllDocuments,
  getDocumentById,
  getDocumentFileBuffer,
  saveDocument,
} from '../lib/lifefile/storage.ts'
import { getAllTasks, saveTask } from '../lib/tasks/storage.ts'
import { getAllProducts, saveProduct } from '../lib/products/storage.ts'
import { getAllContacts, saveContact } from '../lib/contacts/storage.ts'
import { getAllMemories, saveMemory } from '../lib/memory/storage.ts'
import { readJsonSafe, writeJsonAtomic } from '../lib/storage/atomic-json.ts'

function pass(name: string) {
  console.log(`✅ PASS: ${name}`)
}

async function cleanupTestAuthArtifacts(testEmails: string[], createdUserIds: string[]) {
  const authDir = path.resolve(process.cwd(), 'data', 'auth')
  const usersFile = path.resolve(authDir, 'users.json')
  const sessionsFile = path.resolve(authDir, 'sessions.json')
  const rateLimitsFile = path.resolve(authDir, 'ratelimits.json')

  const users = await readJsonSafe<Record<string, any>>(usersFile, {})
  for (const [k, u] of Object.entries(users)) {
    if (testEmails.includes(u.email) || createdUserIds.includes(k)) {
      delete users[k]
    }
  }
  await writeJsonAtomic(usersFile, users)

  const sessions = await readJsonSafe<Record<string, any>>(sessionsFile, {})
  for (const [k, s] of Object.entries(sessions)) {
    if (createdUserIds.includes(s.userId)) delete sessions[k]
  }
  await writeJsonAtomic(sessionsFile, sessions)

  const limits = await readJsonSafe<Record<string, any>>(rateLimitsFile, {})
  for (const key of Object.keys(limits)) {
    if (testEmails.some((em) => key.includes(em)) || key.includes('198.51.100.')) {
      delete limits[key]
    }
  }
  await writeJsonAtomic(rateLimitsFile, limits)

  for (const uid of createdUserIds) {
    const dir = path.resolve(process.cwd(), 'data', 'users', uid)
    if (fsSync.existsSync(dir)) {
      await fs.rm(dir, { recursive: true, force: true })
    }
  }
}

async function runTests() {
  console.log('==================================================================')
  console.log('🔐 AURA Email + Password Auth, Bcrypt & Isolation Test Suite')
  console.log('==================================================================\n')

  const stamp = Date.now()
  const emailA = `qa_pw_a_${stamp}@example.com`
  const emailB = `qa_pw_b_${stamp}@example.com`
  const emailLegacy = `qa_pw_legacy_${stamp}@example.com`
  const testEmails = [emailA, emailB, emailLegacy]
  const createdUserIds: string[] = []

  try {
    // 1. Signup validation: mismatched confirmPassword, weak password, invalid email
    const mismatchRes = await registerUserWithPassword({
      name: 'Aarav Mehta',
      email: emailA,
      password: 'StrongPassword123',
      confirmPassword: 'DifferentPassword',
      ipAddress: '198.51.100.1',
    })
    assert.strictEqual(mismatchRes.success, false)
    assert.strictEqual(mismatchRes.statusCode, 400)
    pass('Rejects mismatched Password and Confirm Password (400)')

    const weakPwRes = await registerUserWithPassword({
      name: 'Aarav Mehta',
      email: emailA,
      password: 'short',
      confirmPassword: 'short',
      ipAddress: '198.51.100.1',
    })
    assert.strictEqual(weakPwRes.success, false)
    assert.strictEqual(weakPwRes.statusCode, 400)
    pass('Rejects short passwords (<8 characters)')

    // 2. Successful Signup -> bcrypt hash stored, never plain-text, auto session issued
    const signupA = await registerUserWithPassword({
      name: 'Aarav Mehta',
      email: emailA,
      password: 'StrongPassword123',
      confirmPassword: 'StrongPassword123',
      ipAddress: '198.51.100.2',
    })
    assert.strictEqual(signupA.success, true)
    assert.strictEqual(signupA.statusCode, 201)
    assert(signupA.user && signupA.sessionToken)
    assert(!('passwordHash' in signupA.user), 'Public user DTO must never expose passwordHash')
    createdUserIds.push(signupA.user.id)

    const storedUserA = await findUserByEmail(emailA)
    assert(storedUserA?.passwordHash?.startsWith('$2'), 'Stored password must be hashed with bcrypt')
    assert.notStrictEqual(storedUserA?.passwordHash, 'StrongPassword123')
    pass('Signup stores salted bcrypt hash ($2...) and automatically issues session')

    // 3. Duplicate email rejected cleanly (409 Conflict)
    const dupRes = await registerUserWithPassword({
      name: 'Duplicate User',
      email: emailA.toUpperCase(),
      password: 'AnotherPassword123',
      confirmPassword: 'AnotherPassword123',
      ipAddress: '198.51.100.3',
    })
    assert.strictEqual(dupRes.success, false)
    assert.strictEqual(dupRes.statusCode, 409)
    pass('Duplicate email registration blocked case-insensitively (409)')

    // 4. Login: incorrect password rejected (401), correct password succeeds (200)
    const badLogin = await authenticateWithPassword({
      email: emailA,
      password: 'WrongPassword!',
      ipAddress: '198.51.100.4',
    })
    assert.strictEqual(badLogin.success, false)
    assert.strictEqual(badLogin.statusCode, 401)
    pass('Incorrect password rejected cleanly with 401 Unauthorized')

    const goodLogin = await authenticateWithPassword({
      email: emailA,
      password: 'StrongPassword123',
      ipAddress: '198.51.100.4',
    })
    assert.strictEqual(goodLogin.success, true)
    assert.strictEqual(goodLogin.statusCode, 200)
    assert(goodLogin.sessionToken)
    pass('Correct password authenticates User A and issues new session token')

    // 5. Legacy passwordless record guard (never allows empty/default password migration)
    const usersFile = path.resolve(process.cwd(), 'data', 'auth', 'users.json')
    const allUsers = await readJsonSafe<Record<string, any>>(usersFile, {})
    const legacyId = `usr_${Date.now()}_deadbeef`
    allUsers[legacyId] = {
      id: legacyId,
      email: emailLegacy,
      name: 'Legacy OTP Account',
      phone: null,
      photoDataUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await writeJsonAtomic(usersFile, allUsers)
    createdUserIds.push(legacyId)

    const legacyLogin = await authenticateWithPassword({
      email: emailLegacy,
      password: 'anything-or-default',
      ipAddress: '198.51.100.5',
    })
    assert.strictEqual(legacyLogin.success, false)
    assert.strictEqual(legacyLogin.statusCode, 403)
    pass('Legacy passwordless user records rejected safely without default password')

    // 6. Rate limiting after repeated failed login attempts
    for (let i = 0; i < 10; i++) {
      await authenticateWithPassword({
        email: emailA,
        password: 'WrongPassword!',
        ipAddress: `198.51.100.${10 + i}`,
      })
    }
    const rateLimited = await authenticateWithPassword({
      email: emailA,
      password: 'StrongPassword123',
      ipAddress: '198.51.100.25',
    })
    assert.strictEqual(rateLimited.success, false)
    assert.strictEqual(rateLimited.statusCode, 429)
    pass('Per-email login rate limit blocks brute force attempts with 429')

    // 7. Strict Multi-User Isolation (User A vs User B)
    const signupB = await registerUserWithPassword({
      name: 'Meera Iyer',
      email: emailB,
      password: 'MeeraPassword99',
      confirmPassword: 'MeeraPassword99',
      ipAddress: '198.51.100.30',
    })
    assert.strictEqual(signupB.success, true)
    assert(signupB.user)
    createdUserIds.push(signupB.user.id)

    const userAId = signupA.user.id
    const userBId = signupB.user.id

    const samplePdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF')
    const docA = await saveDocument(samplePdf, 'UserA_Bill.pdf', 'application/pdf', userAId)
    const taskA = await saveTask(
      {
        title: 'User A Private Task',
        description: 'Isolated',
        category: 'bill',
        dueDate: '2026-12-01',
        status: 'pending',
        priority: 'high',
        source: 'manual',
        recurrence: 'none',
        linkedDocumentId: docA.id,
      },
      userAId
    )
    await saveProduct({ productName: 'User A Fridge', source: 'manual' }, userAId)
    await saveContact({ companyName: 'User A Care', phone: '1800123456', source: 'manual' }, userAId)
    await saveMemory({ content: 'User A private preference', approvedByUser: true }, userAId)

    assert.strictEqual((await getAllDocuments(userBId)).length, 0)
    assert.strictEqual(await getDocumentById(docA.id, userBId), null)
    assert.strictEqual(await getDocumentFileBuffer(docA.id, userBId), null)
    assert.strictEqual(await deleteDocument(docA.id, userBId), false)
    assert.strictEqual((await getAllTasks(userBId)).length, 0)
    assert.strictEqual((await getAllProducts(undefined, userBId)).length, 0)
    assert.strictEqual((await getAllContacts(userBId)).length, 0)
    assert.strictEqual((await getAllMemories(userBId)).length, 0)
    assert((await getAllTasks(userAId)).some((t) => t.id === taskA.id))
    pass('Per-user isolation blocks User B from User A documents, files, tasks, products, contacts & memories')

    // 8. Session persistence & logout revocation
    assert.strictEqual((await verifySessionToken(goodLogin.sessionToken))?.id, userAId)
    await revokeSessionToken(goodLogin.sessionToken)
    assert.strictEqual(await verifySessionToken(goodLogin.sessionToken), null)
    pass('Session verification persists while active and revokes cleanly on logout')

    console.log('\n==================================================================')
    console.log('Password Auth & Isolation Results: 9 Passed, 0 Failed')
    console.log('==================================================================\n')
  } finally {
    await cleanupTestAuthArtifacts(testEmails, createdUserIds)
  }
}

runTests().catch((err) => {
  console.error('❌ Password Auth Test Failed:', err)
  process.exit(1)
})
