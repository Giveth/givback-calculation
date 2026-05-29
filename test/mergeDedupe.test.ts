import assert from 'assert'
import { FormattedDonation } from '../src/types/general'
import { mergeAndDedupeDonations } from '../src/givethIoService'

// Merge/dedupe of v5 + v6 donations — the join the round export relies on
// (Giveth/giveth-v6-core#323, AC #3/#4/#13). Run with:
// npx ts-node --project ./tsconfig.json test/mergeDedupe.test.ts

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

const donation = (
  overrides: Partial<FormattedDonation> = {},
): FormattedDonation => ({
  amount: '100',
  currency: 'DAI',
  createdAt: '2026-05-10-00:00:00',
  valueUsd: 100,
  givbackFactor: 0.8,
  giverAddress: '0xDonor',
  txHash: '0xtx',
  network: 'gnosis',
  source: 'giveth.io',
  giverName: 'Donor',
  anonymous: false,
  ...overrides,
})

// AC #3/#4 — the same on-chain donation present in both v5 and v6 collapses to one row.
check('dedupes the same tx across sources (one row per donation)', () => {
  const merged = mergeAndDedupeDonations(
    [donation({ txHash: '0xsame', network: 'gnosis', source: 'giveth.io' })],
    [donation({ txHash: '0xsame', network: 'gnosis', source: 'giveth-v6-core' })],
  )
  assert.strictEqual(merged.length, 1)
})

// The first-listed source wins on a key collision (eligible passed first upstream).
check('keeps the first occurrence on a tx collision', () => {
  const merged = mergeAndDedupeDonations(
    [donation({ txHash: '0xsame', source: 'giveth.io', giverName: 'first' })],
    [donation({ txHash: '0xsame', source: 'giveth-v6-core', giverName: 'second' })],
  )
  assert.strictEqual(merged.length, 1)
  assert.strictEqual(merged[0].giverName, 'first')
})

// Distinct donations are all retained.
check('keeps distinct donations', () => {
  const merged = mergeAndDedupeDonations(
    [donation({ txHash: '0xa', network: 'gnosis' })],
    [
      donation({ txHash: '0xb', network: 'gnosis' }),
      donation({ txHash: '0xc', network: 'optimism' }),
    ],
  )
  assert.strictEqual(merged.length, 3)
})

// Same tx hash on different networks is NOT a duplicate.
check('same hash on different networks is not a duplicate', () => {
  const merged = mergeAndDedupeDonations(
    [donation({ txHash: '0xhash', network: 'gnosis' })],
    [donation({ txHash: '0xhash', network: 'optimism' })],
  )
  assert.strictEqual(merged.length, 2)
})

// Recurring donations dedupe by parent recurring id (one row per recurring stream).
check('dedupes recurring donations by parentRecurringDonationId', () => {
  const merged = mergeAndDedupeDonations(
    [donation({ txHash: 'recurring-7', parentRecurringDonationId: '7' })],
    [donation({ txHash: 'recurring-7', parentRecurringDonationId: '7' })],
  )
  assert.strictEqual(merged.length, 1)
})

console.log(`\nmergeDedupe.test.ts: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
