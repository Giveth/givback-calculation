import assert from 'assert'
import { FormattedDonation } from '../src/types/general'
import {
  buildGivbacksRoundReport,
  buildRoundDonationCsvRows,
} from '../src/givbacksRoundReportService'

// Run with: npx ts-node --project ./tsconfig.json test/givbacksRoundReport.test.ts

const baseDonation = (
  overrides: Partial<FormattedDonation> = {},
): FormattedDonation => ({
  amount: '100',
  currency: 'DAI',
  createdAt: '2026-05-10-00:00:00',
  valueUsd: 100,
  givbackFactor: 0.8,
  giverAddress: '0xDonorA',
  txHash: '0xtx1',
  network: 'gnosis',
  source: 'giveth.io',
  giverName: 'Donor A',
  anonymous: false,
  valueUsdAfterGivbackFactor: 80,
  isDonationGivbacksEligible: true,
  isProjectGivbacksEligible: true,
  ...overrides,
})

const givPrice = 0.02 // USD per GIV

const donations: FormattedDonation[] = [
  // Donor A, two eligible donations on v5.
  baseDonation({ txHash: '0xa1', valueUsd: 100, valueUsdAfterGivbackFactor: 80 }),
  baseDonation({
    txHash: '0xa2',
    valueUsd: 50,
    valueUsdAfterGivbackFactor: 40,
    network: 'optimism',
  }),
  // Donor B, one eligible donation from v6.
  baseDonation({
    giverAddress: '0xDonorB',
    txHash: '0xb1',
    source: 'giveth-v6-core',
    valueUsd: 200,
    valueUsdAfterGivbackFactor: 150,
  }),
  // Ineligible donation -> must get 0 tickets and not affect the pool.
  baseDonation({
    giverAddress: '0xDonorC',
    txHash: '0xc1',
    valueUsd: 3,
    valueUsdAfterGivbackFactor: 2.4,
    isDonationGivbacksEligible: false,
  }),
]

const { summary, donations: rows } = buildGivbacksRoundReport({
  donations,
  givPrice,
  maxPrizePool: 1_000_000,
  roundStartTime: '2026/05/01-00:00:00',
  roundEndTime: '2026/05/31-23:59:59',
})

const byTx = new Map(rows.map(row => [row.txHash, row]))

// Per-donation raffle tickets = valueUsdAfterGivbackFactor / givPrice for eligible.
assert.strictEqual(byTx.get('0xa1')!.raffleTicketsPerDonation, 80 / givPrice)
assert.strictEqual(byTx.get('0xa2')!.raffleTicketsPerDonation, 40 / givPrice)
assert.strictEqual(byTx.get('0xb1')!.raffleTicketsPerDonation, 150 / givPrice)
// Ineligible -> 0 tickets.
assert.strictEqual(byTx.get('0xc1')!.raffleTicketsPerDonation, 0)

// Per-donor totals sum eligible tickets across the donor's donations.
assert.strictEqual(
  byTx.get('0xa1')!.raffleTicketsPerDonorTotal,
  (80 + 40) / givPrice,
)
assert.strictEqual(
  byTx.get('0xa2')!.raffleTicketsPerDonorTotal,
  (80 + 40) / givPrice,
)
assert.strictEqual(byTx.get('0xb1')!.raffleTicketsPerDonorTotal, 150 / givPrice)
assert.strictEqual(byTx.get('0xc1')!.raffleTicketsPerDonorTotal, 0)

// Prize pool = sum(valueUsdAfterGivbackFactor of eligible) / givPrice, in GIV.
assert.strictEqual(summary.calculatedPrizePool, (80 + 40 + 150) / givPrice)
assert.strictEqual(summary.totalRaffleTickets, summary.calculatedPrizePool)
// Below the cap -> actual = calculated.
assert.strictEqual(summary.actualPrizePool, summary.calculatedPrizePool)
assert.strictEqual(summary.totalEligibleDonations, 3)
assert.strictEqual(summary.totalEligibleDonors, 2)

// Cap applies when calculated exceeds max.
const capped = buildGivbacksRoundReport({
  donations: donations.map(d => ({ ...d })),
  givPrice,
  maxPrizePool: 1000,
  roundStartTime: 's',
  roundEndTime: 'e',
})
assert.strictEqual(capped.summary.actualPrizePool, 1000)
assert.ok(capped.summary.calculatedPrizePool > 1000)

// txLink + source mapping in the CSV rows.
const csvRows = buildRoundDonationCsvRows(rows)
const csvByTx = new Map(csvRows.map(row => [row.txHash, row]))
assert.strictEqual(csvByTx.get('0xa1')!.txLink, 'https://gnosisscan.io/tx/0xa1')
assert.strictEqual(csvByTx.get('0xa1')!.source, 'v5')
assert.strictEqual(csvByTx.get('0xb1')!.source, 'v6')

console.log('givbacksRoundReport.test.ts: all assertions passed')
