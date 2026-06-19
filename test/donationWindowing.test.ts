import assert from 'assert'
import {
  splitDonationDateRange,
  runWithConcurrency,
  dedupeDonationsById,
  clampedNumberFromEnv,
} from '../src/givethIoService'

// Date-range chunking that keeps the giveth.io donations query under the
// gateway's ~60s timeout (issue Giveth/giveth-dapps-v2#5569 — Ashley's monthly
// /calculate export was 504ing). Run with:
// npx ts-node --project ./tsconfig.json test/donationWindowing.test.ts

const moment = require('moment')
const fmt = 'YYYY/MM/DD-HH:mm:ss'
// Mirrors the DONATIONS_QUERY_MAX_WINDOW_DAYS default in givethIoService.ts.
const MAX_WINDOW_DAYS = 5

const checks: Array<{ label: string; fn: () => void | Promise<void> }> = []
const check = (label: string, fn: () => void | Promise<void>) =>
  checks.push({ label, fn })

// --- splitDonationDateRange ---------------------------------------------------

check('returns a single window when the range fits in one chunk', () => {
  const windows = splitDonationDateRange(
    '2026/05/01-00:00:00',
    '2026/05/01-06:00:00',
  )
  assert.strictEqual(windows.length, 1)
  assert.deepStrictEqual(windows[0], {
    from: '2026/05/01-00:00:00',
    to: '2026/05/01-06:00:00',
  })
})

check('splits a month-long range into contiguous, gateway-safe windows', () => {
  const begin = '2026/04/30-16:00:00'
  const end = '2026/05/31-15:59:59'
  const windows = splitDonationDateRange(begin, end)

  assert.ok(windows.length > 1, 'expected multiple windows for a ~month range')
  // Coverage: union of windows spans exactly [begin, end].
  assert.strictEqual(windows[0].from, begin)
  assert.strictEqual(windows[windows.length - 1].to, end)

  for (let i = 0; i < windows.length; i += 1) {
    const spanDays = moment
      .utc(windows[i].to, fmt, true)
      .diff(moment.utc(windows[i].from, fmt, true), 'days', true)
    assert.ok(
      spanDays > 0 && spanDays <= MAX_WINDOW_DAYS + 1e-6,
      `window ${i} span ${spanDays}d must be in (0, ${MAX_WINDOW_DAYS}]`,
    )
    // Contiguity: each window starts exactly where the previous ended, so no
    // donation can fall through a gap.
    if (i > 0) {
      assert.strictEqual(
        windows[i].from,
        windows[i - 1].to,
        'adjacent windows must share a boundary',
      )
    }
  }
})

check('falls back to a single window for unparseable dates', () => {
  const windows = splitDonationDateRange('not-a-date', 'also-bad')
  assert.deepStrictEqual(windows, [{ from: 'not-a-date', to: 'also-bad' }])
})

check('falls back to a single window when end is not after start', () => {
  const windows = splitDonationDateRange(
    '2026/05/10-00:00:00',
    '2026/05/01-00:00:00',
  )
  assert.strictEqual(windows.length, 1)
})

// --- runWithConcurrency -------------------------------------------------------

check('preserves input order and runs every task', async () => {
  const tasks = [10, 20, 30, 40, 50].map(n => () => Promise.resolve(n))
  const results = await runWithConcurrency(tasks, 2)
  assert.deepStrictEqual(results, [10, 20, 30, 40, 50])
})

check('never exceeds the concurrency limit', async () => {
  let inFlight = 0
  let maxInFlight = 0
  const makeTask = () => async () => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise<void>(resolve => setTimeout(resolve, 5))
    inFlight -= 1
    return true
  }
  const tasks = Array.from({ length: 7 }, makeTask)
  await runWithConcurrency(tasks, 3)
  assert.ok(maxInFlight <= 3, `max in-flight ${maxInFlight} exceeded limit 3`)
  assert.ok(maxInFlight > 1, 'expected real concurrency, tasks ran serially')
})

check('returns an empty array for no tasks', async () => {
  const results = await runWithConcurrency<number>([], 4)
  assert.deepStrictEqual(results, [])
})

check('runs all tasks even when the limit exceeds the task count', async () => {
  const tasks = [1, 2, 3].map(n => () => Promise.resolve(n))
  const results = await runWithConcurrency(tasks, 99)
  assert.deepStrictEqual(results, [1, 2, 3])
})

// --- dedupeDonationsById ------------------------------------------------------

check('keeps the first row for a repeated id (boundary overlap)', () => {
  const rows = [
    { id: '1', amount: 'first' },
    { id: '2', amount: 'b' },
    { id: '1', amount: 'dup' },
  ] as any
  const out = dedupeDonationsById(rows)
  assert.strictEqual(out.length, 2)
  assert.strictEqual(out[0].amount, 'first')
  assert.strictEqual(out[1].id, '2')
})

check('keeps every row that has no id', () => {
  const rows = [{ amount: 'x' }, { amount: 'y' }] as any
  const out = dedupeDonationsById(rows)
  assert.strictEqual(out.length, 2)
})

check('keeps distinct ids untouched', () => {
  const rows = [{ id: '1' }, { id: '2' }, { id: '3' }] as any
  const out = dedupeDonationsById(rows)
  assert.strictEqual(out.length, 3)
})

// --- misconfiguration hardening (env-tunable knobs) ---------------------------

check('chunks by an explicit whole-day window size', () => {
  const windows = splitDonationDateRange(
    '2026/05/01-00:00:00',
    '2026/05/10-00:00:00',
    2,
  )
  assert.strictEqual(windows.length, 5) // 9 days / 2-day windows -> 5 windows
  assert.strictEqual(windows[0].from, '2026/05/01-00:00:00')
  assert.strictEqual(windows[windows.length - 1].to, '2026/05/10-00:00:00')
})

// Regression guard for the HIGH review finding: a fractional window size used to
// infinite-loop (moment rounds fractional days to 0). It must clamp to >= 1 day
// and terminate, not hang.
check('does not infinite-loop on a fractional window size', () => {
  const windows = splitDonationDateRange(
    '2026/05/01-00:00:00',
    '2026/05/04-00:00:00',
    0.25,
  )
  assert.ok(windows.length >= 1, 'must terminate and produce windows')
  assert.strictEqual(windows[0].from, '2026/05/01-00:00:00')
  assert.strictEqual(windows[windows.length - 1].to, '2026/05/04-00:00:00')
  for (let i = 1; i < windows.length; i += 1) {
    assert.strictEqual(windows[i].from, windows[i - 1].to)
  }
})

check('clamps a zero / negative window size to at least one day', () => {
  for (const bad of [0, -3]) {
    const windows = splitDonationDateRange(
      '2026/05/01-00:00:00',
      '2026/05/03-00:00:00',
      bad,
    )
    assert.ok(windows.length >= 1, `terminated for windowDays=${bad}`)
    assert.strictEqual(windows[windows.length - 1].to, '2026/05/03-00:00:00')
  }
})

// Regression guard for the review finding: an invalid concurrency limit must
// serialize, NOT fan out every task at once (which would re-trigger the 503s).
check('serializes (does not fan out) when the limit is 0/NaN/negative', async () => {
  for (const badLimit of [0, -1, NaN]) {
    let inFlight = 0
    let maxInFlight = 0
    const tasks = Array.from({ length: 5 }, () => async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>(resolve => setTimeout(resolve, 2))
      inFlight -= 1
      return true
    })
    await runWithConcurrency(tasks, badLimit as number)
    assert.strictEqual(
      maxInFlight,
      1,
      `limit ${badLimit} must serialize, saw ${maxInFlight} in flight`,
    )
  }
})

check('clampedNumberFromEnv sanitizes unset / non-numeric / out-of-range values', () => {
  // unset -> fallback
  assert.strictEqual(clampedNumberFromEnv(undefined, 5, 1), 5)
  // non-numeric -> fallback
  assert.strictEqual(clampedNumberFromEnv('abc', 4, 0), 4)
  // explicit zero clamps to the minimum
  assert.strictEqual(clampedNumberFromEnv('0', 2, 1), 1)
  // negative clamps to the minimum
  assert.strictEqual(clampedNumberFromEnv('-5', 2, 1), 1)
  // fractional rounds to a whole number
  assert.strictEqual(clampedNumberFromEnv('0.25', 5, 1), 1)
  assert.strictEqual(clampedNumberFromEnv('5.6', 5, 1), 6)
  // a valid value passes through
  assert.strictEqual(clampedNumberFromEnv('3', 5, 1), 3)
  // retries allow zero (min 0)
  assert.strictEqual(clampedNumberFromEnv('0', 4, 0), 0)
})

// --- runner -------------------------------------------------------------------

;(async () => {
  let passed = 0
  let failed = 0
  for (const { label, fn } of checks) {
    try {
      await fn()
      passed += 1
    } catch (e: any) {
      failed += 1
      console.error(`FAIL: ${label}\n      ${e?.message ?? e}`)
    }
  }
  console.log(`\ndonationWindowing.test.ts: ${passed} passed, ${failed} failed`)
  if (failed > 0) {
    process.exit(1)
  }
})()
