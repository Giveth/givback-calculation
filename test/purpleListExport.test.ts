import assert from 'assert'
import { PurpleListExportRow } from '../src/types/general'
import { parsePurpleListCsv } from '../src/purpleListExportService'

// AC-mapped unit test for the GIVbacks purple-list CSV export (issue #323).
// Run with: npx ts-node --project ./tsconfig.json test/purpleListExport.test.ts

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

console.log(`\npurpleListExport.test.ts: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
