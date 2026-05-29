import assert from 'assert'
import { GivethIoDonation } from '../src/types/general'
import { isDonationAmountValid } from '../src/utils'

// AC #7 / #8 — USD-minimum eligibility thresholds (Giveth/giveth-v6-core#323).
// Run with: npx ts-node --project ./tsconfig.json test/eligibilityThreshold.test.ts

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

const GIVETH_SLUG = 'the-giveth-community-of-makers'

const valid = (valueUsd: number, slug: string) =>
  isDonationAmountValid({
    donation: { valueUsd, project: { slug } } as GivethIoDonation,
    minEligibleValueUsd: 4,
    givethCommunityProjectSlug: GIVETH_SLUG,
  })

// AC #7 — regular donations eligible at the $4 minimum.
check('AC#7 regular donation below $4 is ineligible', () => {
  assert.strictEqual(valid(3.99, 'some-project'), false)
})
check('AC#7 regular donation above $4 is eligible', () => {
  assert.strictEqual(valid(4.01, 'some-project'), true)
})
check('AC#7 regular donation at exactly $4 is eligible (>=)', () => {
  // NOTE: implementation uses >= 4; the AC text says "> 4". Documents current
  // behavior — flip this expectation if the team confirms strict >.
  assert.strictEqual(valid(4, 'some-project'), true)
})

// AC #8 — donations to Giveth eligible above $0.05 (strict >).
check('AC#8 Giveth donation at exactly $0.05 is ineligible', () => {
  assert.strictEqual(valid(0.05, GIVETH_SLUG), false)
})
check('AC#8 Giveth donation above $0.05 is eligible', () => {
  assert.strictEqual(valid(0.06, GIVETH_SLUG), true)
})
check('AC#8 Giveth donation below the regular minimum still eligible (lower bar)', () => {
  assert.strictEqual(valid(1, GIVETH_SLUG), true)
})

console.log(`\neligibilityThreshold.test.ts: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
