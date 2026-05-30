import assert from 'assert'
import type { Request, Response } from 'express'
import { adminExportAuth } from '../src/adminAuth'

// HTTP Basic Auth guard for the GIVbacks admin export endpoints (issue #323).
// Run with: npx ts-node --project ./tsconfig.json test/adminAuth.test.ts

let passed = 0
let failed = 0
const check = (label: string, fn: () => void) => {
  try {
    fn()
    passed += 1
  } catch (e: any) {
    failed += 1
    console.error(`FAIL: ${label}\n      ${e?.message ?? e}`)
  }
}

interface MockRes {
  statusCode: number
  headers: Record<string, string>
  body: unknown
  setHeader: (k: string, v: string) => void
  status: (c: number) => MockRes
  send: (b: unknown) => MockRes
}

const mockRes = (): MockRes => {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
  } as MockRes
  res.setHeader = (k, v) => {
    res.headers[k] = v
  }
  res.status = c => {
    res.statusCode = c
    return res
  }
  res.send = b => {
    res.body = b
    return res
  }
  return res
}

const basic = (u: string, p: string) =>
  'Basic ' + Buffer.from(`${u}:${p}`).toString('base64')

const run = (authorization?: string) => {
  const res = mockRes()
  let nexted = false
  const req = { headers: authorization ? { authorization } : {} } as Request
  adminExportAuth(req, res as unknown as Response, () => {
    nexted = true
  })
  return { res, nexted }
}

// Fails closed when the password env var is not configured.
check('fails closed (401) when ADMIN_EXPORT_PASSWORD is unset', () => {
  delete process.env.ADMIN_EXPORT_PASSWORD
  const { res, nexted } = run(basic('admin', 'anything'))
  assert.strictEqual(res.statusCode, 401)
  assert.strictEqual(nexted, false)
})

// With a configured password:
process.env.ADMIN_EXPORT_USERNAME = 'admin'
process.env.ADMIN_EXPORT_PASSWORD = 's3cret'

check('401 + challenge header when no Authorization header is present', () => {
  const { res, nexted } = run()
  assert.strictEqual(res.statusCode, 401)
  assert.ok(res.headers['WWW-Authenticate'])
  assert.strictEqual(nexted, false)
})

check('401 on a wrong password', () => {
  const { res, nexted } = run(basic('admin', 'wrong'))
  assert.strictEqual(res.statusCode, 401)
  assert.strictEqual(nexted, false)
})

check('401 on a wrong username', () => {
  const { res, nexted } = run(basic('attacker', 's3cret'))
  assert.strictEqual(res.statusCode, 401)
  assert.strictEqual(nexted, false)
})

check('401 on a non-Basic scheme', () => {
  const { res, nexted } = run('Bearer s3cret')
  assert.strictEqual(res.statusCode, 401)
  assert.strictEqual(nexted, false)
})

check('calls next() on correct credentials', () => {
  const { nexted } = run(basic('admin', 's3cret'))
  assert.strictEqual(nexted, true)
})

console.log(`\nadminAuth.test.ts: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
