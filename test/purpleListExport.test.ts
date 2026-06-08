import assert from 'assert'
import { PurpleListExportRow } from '../src/types/general'
import { parsePurpleListCsv, getPurpleListAddressSet } from '../src/purpleListExportService'

// AC-mapped unit test for the GIVbacks purple-list CSV export (issue #323).
// Run with: npx ts-node --project ./tsconfig.json test/purpleListExport.test.ts

let passed = 0
let failed = 0
// Async-aware test runner. Sync test bodies still work (they resolve to
// undefined). Previously `check` was synchronous and counted async tests as
// passed before their assertions resolved — a real failure landed as an
// unhandled rejection and the test still printed "passed".
const tests: Array<{ label: string; fn: () => void | Promise<void> }> = []
const check = (label: string, fn: () => void | Promise<void>) => {
  tests.push({ label, fn })
}

const rows: PurpleListExportRow[] = [
  {
    address: '0xRecipient',
    network: 'gnosis',
    source: 'projectRecipientAddress',
    projectLink: 'https://giveth.io/project/project-one',
  },
  {
    address: 'GABCSTELLAR',
    network: 'stellar',
    source: 'givbacksEligibilityForm',
    projectLink: 'https://giveth.io/project/project-two',
  },
]

// AC #19 — purple list is exportable as a CSV with the required columns.
check('AC#19 purple-list CSV has the 4 required columns in order', () => {
  const csv = parsePurpleListCsv(rows)
  const header = csv.split('\n')[0]
  const columns = header.split(',').map(c => c.replace(/^"|"$/g, ''))
  assert.deepStrictEqual(columns, ['address', 'network', 'source', 'projectLink'])
})

// AC #20 / #21 — recipient and eligibility-form sources are both representable.
check('AC#20/#21 rows carry recipient + eligibility-form sources', () => {
  const csv = parsePurpleListCsv(rows)
  const lines = csv.trim().split('\n')
  assert.strictEqual(lines.length, rows.length + 1) // + header
  assert.ok(csv.includes('projectRecipientAddress'))
  assert.ok(csv.includes('givbacksEligibilityForm'))
  assert.ok(csv.includes('0xRecipient'))
  assert.ok(csv.includes('GABCSTELLAR'))
})

// AC #18 — v6 purple list fetch must soft-fail to empty when v6 Core is
// unreachable / missing env config, so v5-only filtering still works. Now
// that env is read at call time (not module load), this test deterministically
// hits the "missing config" branch in getPurpleListExportRows regardless of
// what the developer's local .env happens to set.
check('AC#18 v6 purple-list fetch soft-fails to empty Set when env unset', async () => {
  const originalUrl = process.env.GIVETH_V6_CORE_API_URL
  const originalPwd = process.env.POWER_SYNC_PASSWORD
  delete process.env.GIVETH_V6_CORE_API_URL
  delete process.env.POWER_SYNC_PASSWORD
  try {
    const result = await getPurpleListAddressSet()
    assert.ok(result instanceof Set, 'should return a Set')
    assert.strictEqual(result.size, 0, 'should be empty when env is missing')
  } finally {
    if (originalUrl !== undefined) process.env.GIVETH_V6_CORE_API_URL = originalUrl
    if (originalPwd !== undefined) process.env.POWER_SYNC_PASSWORD = originalPwd
  }
})

// AC #18 — async-helper regression guard. If `check` silently swallows async
// rejections again, this would print "passed" instead of failing.
check('AC#18 async runner actually catches rejected promises', async () => {
  let caught = false
  try {
    await Promise.reject(new Error('intentional'))
  } catch {
    caught = true
  }
  assert.strictEqual(caught, true)
})

// Run all tests sequentially (avoids races on shared process.env between
// async tests).
;(async () => {
  for (const { label, fn } of tests) {
    try {
      await fn()
      passed += 1
    } catch (e: any) {
      failed += 1
      console.error(`FAIL: ${label}\n      ${e?.message ?? e}`)
    }
  }
  console.log(`\npurpleListExport.test.ts: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exit(1)
  }
})()
