import assert from 'assert'

// Unit test for the /givbacks-round-report input defaulting that QA flagged
// (issue Giveth/giveth-v6-core#323): when minEligibleValueUsd is omitted it must
// default to the documented $4, not 0. The handler's parse is replicated here as
// a pure function so we can assert it without booting Express.
// Run with: npx ts-node --project ./tsconfig.json test/roundReportInputs.test.ts

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

const DEFAULT_MIN_ELIGIBLE_VALUE_USD = 4

// Mirror of the parse in src/index.ts /givbacks-round-report handler.
const resolveMinEligibleValueUsd = (raw: unknown): number =>
  raw !== undefined && Number.isFinite(Number(raw))
    ? Number(raw)
    : DEFAULT_MIN_ELIGIBLE_VALUE_USD

check('omitted -> defaults to $4 (not 0)', () => {
  assert.strictEqual(resolveMinEligibleValueUsd(undefined), 4)
})

check('explicit 0 is honored (operator override)', () => {
  assert.strictEqual(resolveMinEligibleValueUsd('0'), 0)
})

check('explicit value is honored', () => {
  assert.strictEqual(resolveMinEligibleValueUsd('10'), 10)
})

check('non-numeric garbage -> default $4', () => {
  assert.strictEqual(resolveMinEligibleValueUsd('abc'), 4)
})

check('empty string -> Number("") is 0 which is finite, honored as 0', () => {
  // Express omits absent params (undefined); an explicit empty value is rare,
  // but Number('') === 0 is finite, so it resolves to 0. Documented here so the
  // behavior is intentional, not accidental.
  assert.strictEqual(resolveMinEligibleValueUsd(''), 0)
})

console.log(`\nroundReportInputs.test.ts: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
