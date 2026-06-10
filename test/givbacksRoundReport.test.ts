import assert from 'assert'
import { FormattedDonation } from '../src/types/general'
import {
  buildGivbacksRoundReport,
  buildRoundDonationCsvRows,
  parseRoundDonationsCsv,
} from '../src/givbacksRoundReportService'

// AC-mapped unit tests for the GIVbacks round report (Giveth/giveth-v6-core#323).
// Run with: npx ts-node --project ./tsconfig.json test/givbacksRoundReport.test.ts

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

const GIV_PRICE = 0.02 // USD per GIV

const donation = (
  overrides: Partial<FormattedDonation> = {},
): FormattedDonation => ({
  amount: '100',
  currency: 'DAI',
  createdAt: '2026-05-10-00:00:00',
  valueUsd: 100,
  givbackFactor: 0.8,
  giverAddress: '0xDonorA',
  txHash: '0xtx',
  network: 'gnosis',
  source: 'giveth.io',
  giverName: 'Donor A',
  anonymous: false,
  valueUsdAfterGivbackFactor: 80,
  isDonationGivbacksEligible: true,
  isProjectGivbacksEligible: true,
  ...overrides,
})

const sampleDonations = (): FormattedDonation[] => [
  // Donor A — two eligible donations (v5).
  donation({ txHash: '0xa1', valueUsdAfterGivbackFactor: 80 }),
  donation({ txHash: '0xa2', network: 'optimism', valueUsdAfterGivbackFactor: 40 }),
  // Donor B — one eligible donation (v6).
  donation({
    giverAddress: '0xDonorB',
    txHash: '0xb1',
    source: 'giveth-v6-core',
    valueUsdAfterGivbackFactor: 150,
  }),
  // Donor C — ineligible.
  donation({
    giverAddress: '0xDonorC',
    txHash: '0xc1',
    valueUsdAfterGivbackFactor: 2.4,
    isDonationGivbacksEligible: false,
  }),
]

const buildSample = (maxPrizePool = 1_000_000) =>
  buildGivbacksRoundReport({
    donations: sampleDonations(),
    givPrice: GIV_PRICE,
    maxPrizePool,
    roundStartTime: '2026/05/01-00:00:00',
    roundEndTime: '2026/05/31-23:59:59',
  })

// AC #11 — raffleTicketsPerDonation = valueUsdAfterGivbackFactor / givPrice (eligible).
check('AC#11 raffleTicketsPerDonation for eligible donations', () => {
  const byTx = new Map(buildSample().donations.map(d => [d.txHash, d]))
  assert.strictEqual(byTx.get('0xa1')!.raffleTicketsPerDonation, 80 / GIV_PRICE)
  assert.strictEqual(byTx.get('0xa2')!.raffleTicketsPerDonation, 40 / GIV_PRICE)
  assert.strictEqual(byTx.get('0xb1')!.raffleTicketsPerDonation, 150 / GIV_PRICE)
})

// AC #10 — ineligible donations show 0 raffle tickets.
check('AC#10 ineligible donations get 0 raffle tickets', () => {
  const byTx = new Map(buildSample().donations.map(d => [d.txHash, d]))
  assert.strictEqual(byTx.get('0xc1')!.raffleTicketsPerDonation, 0)
})

// AC #12 — raffleTicketsPerDonorTotal sums a donor's eligible donations.
check('AC#12 raffleTicketsPerDonorTotal per donor', () => {
  const byTx = new Map(buildSample().donations.map(d => [d.txHash, d]))
  assert.strictEqual(byTx.get('0xa1')!.raffleTicketsPerDonorTotal, (80 + 40) / GIV_PRICE)
  assert.strictEqual(byTx.get('0xa2')!.raffleTicketsPerDonorTotal, (80 + 40) / GIV_PRICE)
  assert.strictEqual(byTx.get('0xb1')!.raffleTicketsPerDonorTotal, 150 / GIV_PRICE)
  assert.strictEqual(byTx.get('0xc1')!.raffleTicketsPerDonorTotal, 0)
})

// AC #12 — per-donor total is case-insensitive on the giver address.
check('AC#12 donor totals are case-insensitive on address', () => {
  const { donations } = buildGivbacksRoundReport({
    donations: [
      donation({ giverAddress: '0xABC', txHash: '0x1', valueUsdAfterGivbackFactor: 10 }),
      donation({ giverAddress: '0xabc', txHash: '0x2', valueUsdAfterGivbackFactor: 30 }),
    ],
    givPrice: GIV_PRICE,
    maxPrizePool: 1_000_000,
    roundStartTime: 's',
    roundEndTime: 'e',
  })
  for (const d of donations) {
    assert.strictEqual(d.raffleTicketsPerDonorTotal, (10 + 30) / GIV_PRICE)
  }
})

// AC #13 — raffle tickets include eligible donations from both v5 and v6.
check('AC#13 v5 + v6 eligible donations both counted', () => {
  const { summary } = buildSample()
  // 3 eligible (2 v5 + 1 v6); only ineligible v5 excluded.
  assert.strictEqual(summary.totalEligibleDonations, 3)
})

// AC #14 — calculatedPrizePool = sum(valueUsdAfterGivbackFactor of eligible) / givPrice.
check('AC#14 calculatedPrizePool', () => {
  const { summary } = buildSample()
  assert.strictEqual(summary.calculatedPrizePool, (80 + 40 + 150) / GIV_PRICE)
})

// AC #15 — actualPrizePool = min(calculatedPrizePool, maxPrizePool).
check('AC#15 actualPrizePool under the cap', () => {
  const { summary } = buildSample(1_000_000)
  assert.strictEqual(summary.actualPrizePool, summary.calculatedPrizePool)
})
check('AC#15 actualPrizePool capped at maxPrizePool', () => {
  const { summary } = buildSample(1000)
  assert.strictEqual(summary.actualPrizePool, 1000)
  assert.ok(summary.calculatedPrizePool > 1000)
})

// AC #16 — calculator returns calculatedPrizePool, maxPrizePool, actualPrizePool, givPrice.
check('AC#16 summary returns the prize-pool fields', () => {
  const { summary } = buildSample(1234)
  assert.strictEqual(typeof summary.calculatedPrizePool, 'number')
  assert.strictEqual(summary.maxPrizePool, 1234)
  assert.strictEqual(typeof summary.actualPrizePool, 'number')
  assert.strictEqual(summary.givPrice, GIV_PRICE)
})

// AC #17 — returns total eligible donations, eligible donors, and raffle tickets.
check('AC#17 summary totals (donations, donors, tickets == pool)', () => {
  const { summary } = buildSample()
  assert.strictEqual(summary.totalEligibleDonations, 3)
  assert.strictEqual(summary.totalEligibleDonors, 2) // Donor A + Donor B
  assert.strictEqual(summary.totalRaffleTickets, summary.calculatedPrizePool)
})

// AC #4 — one row per donation.
check('AC#4 one CSV row per donation', () => {
  const { donations } = buildSample()
  const rows = buildRoundDonationCsvRows(donations)
  assert.strictEqual(rows.length, donations.length)
})

// AC #5 — the export includes all required columns, in order.
check('AC#5 CSV header has all 21 required columns in order', () => {
  const csv = parseRoundDonationsCsv(buildSample().donations)
  const header = csv.split('\n')[0]
  const columns = header.split(',').map(c => c.replace(/^"|"$/g, ''))
  assert.deepStrictEqual(columns, [
    'txLink',
    'donorMasterName',
    'amount',
    'currency',
    'createdAt',
    'valueUsd',
    'anonymous',
    'givbackFactor',
    'valueUsdAfterGivbackFactor',
    'giverAddress',
    'txHash',
    'network',
    'source',
    'giverName',
    'giverEmail',
    'projectLink',
    'parentRecurringDonationTxHash',
    'isDonationGivbacksEligible',
    'isProjectGivbacksEligible',
    'raffleTicketsPerDonation',
    'raffleTicketsPerDonorTotal',
  ])
})

// AC #18 — export is available as CSV (header + one line per donation).
check('AC#18 CSV serializes a line per donation', () => {
  const { donations } = buildSample()
  const csv = parseRoundDonationsCsv(donations)
  const lines = csv.trim().split('\n')
  assert.strictEqual(lines.length, donations.length + 1) // + header
})

// AC #3 — source column is normalized to v5 / v6.
check('AC#3 source column maps to v5 / v6', () => {
  const rows = buildRoundDonationCsvRows(buildSample().donations)
  const byTx = new Map(rows.map(r => [r.txHash, r]))
  assert.strictEqual(byTx.get('0xa1')!.source, 'v5')
  assert.strictEqual(byTx.get('0xb1')!.source, 'v6')
})

// Export column: txLink is a block-explorer URL (or empty for unknown networks).
check('txLink built from network + txHash', () => {
  const rows = buildRoundDonationCsvRows(buildSample().donations)
  const byTx = new Map(rows.map(r => [r.txHash, r]))
  assert.strictEqual(byTx.get('0xa1')!.txLink, 'https://gnosisscan.io/tx/0xa1')
  assert.strictEqual(byTx.get('0xa2')!.txLink, 'https://optimistic.etherscan.io/tx/0xa2')
})
check('txLink empty for unknown network', () => {
  const { donations } = buildGivbacksRoundReport({
    donations: [donation({ network: 'no-such-chain', txHash: '0xz' })],
    givPrice: GIV_PRICE,
    maxPrizePool: 1_000_000,
    roundStartTime: 's',
    roundEndTime: 'e',
  })
  assert.strictEqual(buildRoundDonationCsvRows(donations)[0].txLink, '')
})

// valueUsdAfterGivbackFactor is recomputed from valueUsd * givbackFactor when missing.
check('valueUsdAfterGivbackFactor recomputed when absent', () => {
  const { donations } = buildGivbacksRoundReport({
    donations: [
      donation({
        txHash: '0xrecompute',
        valueUsd: 200,
        givbackFactor: 0.5,
        valueUsdAfterGivbackFactor: undefined,
      }),
    ],
    givPrice: GIV_PRICE,
    maxPrizePool: 1_000_000,
    roundStartTime: 's',
    roundEndTime: 'e',
  })
  assert.strictEqual(donations[0].valueUsdAfterGivbackFactor, 100) // 200 * 0.5
  assert.strictEqual(donations[0].raffleTicketsPerDonation, 100 / GIV_PRICE)
})

// Guard: a non-positive / non-finite GIV price is rejected.
check('rejects an invalid GIV price', () => {
  assert.throws(() =>
    buildGivbacksRoundReport({
      donations: sampleDonations(),
      givPrice: 0,
      maxPrizePool: 1_000_000,
      roundStartTime: 's',
      roundEndTime: 'e',
    }),
  )
})

console.log(`\ngivbacksRoundReport.test.ts: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
