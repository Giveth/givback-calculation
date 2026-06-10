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

// Mirror of the parse in src/index.ts /givbacks-round-report handler: default
// to $4 when omitted, honor a valid explicit value (incl. 0), and THROW on a
// negative or non-numeric value rather than silently broadening eligibility.
const resolveMinEligibleValueUsd = (raw: unknown): number => {
  if (raw === undefined) {
    return DEFAULT_MIN_ELIGIBLE_VALUE_USD
  }
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('minEligibleValueUsd must be a non-negative number')
  }
  return parsed
}

check('omitted -> defaults to $4 (not 0)', () => {
  assert.strictEqual(resolveMinEligibleValueUsd(undefined), 4)
})

check('explicit 0 is honored (operator override)', () => {
  assert.strictEqual(resolveMinEligibleValueUsd('0'), 0)
})

check('explicit value is honored', () => {
  assert.strictEqual(resolveMinEligibleValueUsd('10'), 10)
})

check('non-numeric garbage -> throws (rejected, not silently defaulted)', () => {
  assert.throws(() => resolveMinEligibleValueUsd('abc'), /non-negative/)
})

check('negative value -> throws (does not broaden eligibility)', () => {
  assert.throws(() => resolveMinEligibleValueUsd('-1'), /non-negative/)
})

check('empty string -> Number("") is 0 which is finite, honored as 0', () => {
  // Express omits absent params (undefined); an explicit empty value is rare,
  // but Number('') === 0 is finite and non-negative, so it resolves to 0.
  // Documented here so the behavior is intentional, not accidental.
  assert.strictEqual(resolveMinEligibleValueUsd(''), 0)
})

console.log(`\nroundReportInputs.test.ts: ${passed} passed, ${failed} failed`)
if (failed > 0) {
  process.exit(1)
}
