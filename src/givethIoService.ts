import TokenDistroJSON from '../abi/TokenDistroV2.json';
import { GIVETH_TOKEN_DISTRO_ADDRESS } from "./subgraphService";
import {
  FormattedDonation,
  GIVbacksRound,
  GivethIoDonation,
  MinimalDonation,
  Project
} from "./types/general";

const Ethers = require("ethers");
const { isAddress } = require("ethers");

require('dotenv').config()

const { gql, request } = require('graphql-request');
const axios = require('axios');
const moment = require('moment')
const _ = require('underscore')

import {
  donationValueAfterGivFactor,
  filterDonationsWithPurpleList, groupDonationsByParentRecurringId,
  purpleListDonations
} from './commonServices';
import { getPurpleListAddressSet } from './purpleListExportService';
import {
  calculateReferralReward,
  calculateReferralRewardFromRemainingAmount,
  getNetworkNameById,
  isDonationAmountValid
} from "./utils";

const givethiobaseurl = process.env.GIVETHIO_BASE_URL
const givethV6CoreApiUrl = process.env.GIVETH_V6_CORE_API_URL
const givethV6CoreApiPassword = process.env.POWER_SYNC_PASSWORD
const givethV6CoreApiPasswordHeader =
  process.env.POWER_SYNC_PASSWORD_HEADER || 'x-power-sync-password'
const givethV6CoreApiTimeoutMs = Number(
  process.env.GIVETH_V6_CORE_API_TIMEOUT_MS || 15000,
)
const xdaiNodeHttpUrl = process.env.XDAI_NODE_HTTP_URL
const twoWeeksInMilliseconds = 1209600000
console.log()
const ROUND_20_OFFSET = 345600000; //4 days in miliseconds - At round 20 we changed the rounds from Fridays to Tuesdays
const gnosisProvider = new Ethers.JsonRpcProvider(xdaiNodeHttpUrl);
const tokenDistroGC = new Ethers.Contract(GIVETH_TOKEN_DISTRO_ADDRESS, TokenDistroJSON.abi, gnosisProvider);


export const isEvmAddress = (address: string): boolean => {
  return isAddress(address);
};

const isStellarDonationAndUserLoggedInWithEvmAddress = (donation: GivethIoDonation): boolean => {
  console.log('isStellarDonationAndUserLoggedIn', donation)
  return Boolean(donation.transactionNetworkId === 1500 && donation?.user?.walletAddress && isEvmAddress(donation?.user?.walletAddress))
}

const donationGiverAddress = (donation: GivethIoDonation): string => {
  return isStellarDonationAndUserLoggedInWithEvmAddress(donation) ? donation.user.walletAddress : donation.fromWalletAddress
}

// Converts an API date (YYYY/MM/DD-HH:mm:ss) into the giveth.io GraphQL literal
// (YYYYMMDD HH:mm:ss). The result is interpolated directly into the GraphQL
// query string, so anything that isn't exactly digits/space/colons is rejected
// to prevent GraphQL injection through the date params.
const toGivethIoQueryDate = (apiDate: string, fieldName: string): string => {
  const queryDate = String(apiDate || '').split('/').join('').replace('-', ' ')
  if (!/^\d{8} \d{2}:\d{2}:\d{2}$/.test(queryDate)) {
    throw new Error(`Invalid ${fieldName}`)
  }
  return queryDate
}

// The giveth.io GraphQL gateway returns a 504 on a single
// `donations(fromDate, toDate)` query once the requested range gets large — a
// ~1-month window now exceeds the ~60s gateway limit, which broke Ashley's
// monthly /calculate export (issue Giveth/giveth-dapps-v2#5569). Empirically the
// query costs ~2.5s per day of range, so we split the range into sub-windows
// that each return well under the timeout, fetch them with bounded concurrency,
// and combine the results. Both knobs are env-overridable so ops can retune them
// as impact-graph's performance changes without a code release.
// Reads a numeric env knob, falling back to `fallback` when unset or
// non-numeric, then clamps to a whole number >= min. Sanitizing at parse time
// stops a fat-fingered ops override from breaking the windowed fetch — e.g. a
// fractional window count (moment rounds fractional days to whole, so 0.25 days
// would round to 0 and infinite-loop), a 0/negative concurrency (would remove
// the cap entirely), or a NaN/negative retry count (would skip the fetch and
// throw `undefined`). See issue Giveth/giveth-dapps-v2#5569.
export const clampedNumberFromEnv = (
  raw: string | undefined,
  fallback: number,
  min: number,
): number => {
  const parsed = Number(raw)
  const value = Number.isFinite(parsed) ? parsed : fallback
  return Math.max(min, Math.round(value))
}

// Whole days per sub-window, minimum 1 (moment can't advance by a fractional day).
const DONATIONS_QUERY_MAX_WINDOW_DAYS = clampedNumberFromEnv(
  process.env.DONATIONS_QUERY_MAX_WINDOW_DAYS,
  5,
  1,
)
// Kept low on purpose: the giveth.io gateway returns 503 (Service Unavailable)
// when too many heavy donation queries arrive at once, so we trickle the
// sub-windows rather than fan them all out (issue Giveth/giveth-dapps-v2#5569).
// Minimum 1 so a 0/negative override serializes rather than removing the cap.
const DONATIONS_QUERY_CONCURRENCY = clampedNumberFromEnv(
  process.env.DONATIONS_QUERY_CONCURRENCY,
  2,
  1,
)
// A single sub-window failing (transient 503/504/network blip from the gateway)
// must not fail the whole report — retry it with exponential backoff.
const DONATIONS_QUERY_MAX_RETRIES = clampedNumberFromEnv(
  process.env.DONATIONS_QUERY_MAX_RETRIES,
  4,
  0,
)
const DONATIONS_QUERY_RETRY_BASE_MS = clampedNumberFromEnv(
  process.env.DONATIONS_QUERY_RETRY_BASE_MS,
  1500,
  0,
)
const GIVETHIO_DATE_FORMAT = 'YYYY/MM/DD-HH:mm:ss'

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

// Runs a single donations sub-window query, retrying transient gateway failures
// (503/504/timeouts) with exponential backoff before giving up.
const requestDonationsWindow = async (
  query: string,
  label: string,
): Promise<{ donations?: GivethIoDonation[] }> => {
  let lastError: unknown
  for (let attempt = 0; attempt <= DONATIONS_QUERY_MAX_RETRIES; attempt += 1) {
    try {
      return await request(`${givethiobaseurl}/graphql`, query)
    } catch (error) {
      lastError = error
      if (attempt === DONATIONS_QUERY_MAX_RETRIES) {
        break
      }
      const delay = DONATIONS_QUERY_RETRY_BASE_MS * Math.pow(2, attempt)
      console.log(
        `donations sub-window ${label} failed (attempt ${attempt + 1}/${
          DONATIONS_QUERY_MAX_RETRIES + 1
        }), retrying in ${delay}ms`,
        error instanceof Error ? error.message : error,
      )
      await sleep(delay)
    }
  }
  // Defensive: with the retry count clamped to >= 0 the loop always runs at
  // least once, so lastError is set — but never surface a bare `undefined`.
  throw (
    lastError ??
    new Error(`donations sub-window ${label} failed (no attempt was made)`)
  )
}

// Splits [beginDate, endDate] (API format YYYY/MM/DD-HH:mm:ss) into contiguous
// sub-windows no longer than DONATIONS_QUERY_MAX_WINDOW_DAYS each. Consecutive
// windows share a boundary second (window N's end === window N+1's start) so the
// union covers the whole range with no gap; a donation landing exactly on a
// shared boundary can be fetched twice and is removed later by dedupeDonationsById.
// Falls back to a single window (the original range) when the range already fits
// or the dates can't be parsed — downstream validation handles bad input.
export const splitDonationDateRange = (
  beginDate: string,
  endDate: string,
  maxWindowDays: number = DONATIONS_QUERY_MAX_WINDOW_DAYS,
): Array<{ from: string; to: string }> => {
  // Whole days, at least 1. moment's .add() rounds a fractional day count to the
  // nearest whole day, so a fractional window (e.g. 0.25) would advance the
  // cursor by 0 and loop forever — sanitize defensively even though the module
  // knob is already clamped (issue Giveth/giveth-dapps-v2#5569).
  const windowDays = Number.isFinite(maxWindowDays)
    ? Math.max(1, Math.round(maxWindowDays))
    : 0
  const start = moment.utc(beginDate, GIVETHIO_DATE_FORMAT, true)
  const end = moment.utc(endDate, GIVETHIO_DATE_FORMAT, true)
  if (!start.isValid() || !end.isValid() || !end.isAfter(start) || windowDays <= 0) {
    return [{ from: beginDate, to: endDate }]
  }

  const windows: Array<{ from: string; to: string }> = []
  let cursor = start.clone()
  while (cursor.isBefore(end)) {
    const next = moment.min(cursor.clone().add(windowDays, 'days'), end)
    // Defensive: a non-advancing window would loop forever. Emit one final
    // window covering the remainder and stop.
    if (!next.isAfter(cursor)) {
      windows.push({
        from: cursor.format(GIVETHIO_DATE_FORMAT),
        to: end.format(GIVETHIO_DATE_FORMAT),
      })
      break
    }
    windows.push({
      from: cursor.format(GIVETHIO_DATE_FORMAT),
      to: next.format(GIVETHIO_DATE_FORMAT),
    })
    cursor = next.clone()
  }
  return windows.length > 0 ? windows : [{ from: beginDate, to: endDate }]
}

// Runs async tasks with at most `limit` in flight at once, preserving input
// order in the returned results. Keeps concurrent load on the giveth.io gateway
// bounded so individual sub-window requests stay well under its timeout.
export const runWithConcurrency = async <T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> => {
  const results: T[] = new Array(tasks.length)
  // An invalid limit (0, negative, NaN) serializes rather than fanning out every
  // task at once — the opposite of the throttle's intent (Giveth/giveth-dapps-v2#5569).
  const effectiveLimit =
    Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const current = nextIndex
      nextIndex += 1
      if (current >= tasks.length) {
        return
      }
      results[current] = await tasks[current]()
    }
  }
  const workerCount = Math.min(effectiveLimit, tasks.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
}

// Removes donations that appear more than once by their v5 id (the only way the
// same donation can show up twice is the shared boundary second between adjacent
// sub-windows). Rows without an id are always kept.
export const dedupeDonationsById = (
  donations: GivethIoDonation[],
): GivethIoDonation[] => {
  const seenIds = new Set<string>()
  const deduped: GivethIoDonation[] = []
  for (const donation of donations) {
    const id =
      donation && donation.id !== undefined && donation.id !== null
        ? String(donation.id)
        : undefined
    if (id !== undefined) {
      if (seenIds.has(id)) {
        continue
      }
      seenIds.add(id)
    }
    deduped.push(donation)
  }
  return deduped
}

// Fetches every giveth.io donation in [beginDate, endDate] by splitting the
// range into gateway-safe sub-windows (see splitDonationDateRange), running them
// with bounded concurrency, then concatenating and deduping by id so the result
// matches what a single full-range query would have returned. `buildQuery`
// produces the GraphQL document for one sub-window (callers select different
// fields).
const fetchGivethIoDonationsInWindows = async (
  beginDate: string,
  endDate: string,
  buildQuery: (fromQueryDate: string, toQueryDate: string) => string,
): Promise<GivethIoDonation[]> => {
  const windows = splitDonationDateRange(beginDate, endDate)
  const tasks = windows.map(({ from, to }, index) => async () => {
    const fromQueryDate = toGivethIoQueryDate(from, 'startDate')
    const toQueryDate = toGivethIoQueryDate(to, 'endDate')
    const result = await requestDonationsWindow(
      buildQuery(fromQueryDate, toQueryDate),
      `${index + 1}/${windows.length} [${from} -> ${to}]`,
    )
    return (result?.donations || []) as GivethIoDonation[]
  })

  const windowResults = await runWithConcurrency(
    tasks,
    DONATIONS_QUERY_CONCURRENCY,
  )
  const combined = ([] as GivethIoDonation[]).concat(...windowResults)
  return windows.length > 1 ? dedupeDonationsById(combined) : combined
}

// "Master" donor name = the donor's full profile name. v5 has no dedicated
// column, so we compose first + last name and fall back to the display name.
// Each part is trimmed before joining so unsanitized inputs (e.g.
// `firstName: '  John  '`) don't bleed stray whitespace into the export.
const composeDonorMasterName = (user?: {
  name?: string,
  firstName?: string,
  lastName?: string
}): string | undefined => {
  if (!user) {
    return undefined
  }
  const fullName = [user.firstName, user.lastName]
    .map(part => (typeof part === 'string' ? part.trim() : ''))
    .filter(part => part.length > 0)
    .join(' ')
  return fullName || user.name?.trim() || undefined
}

// Formats a donation to a GIVbacks-eligible (verified) project. Shared between
// the eligible list and the below-minimum ineligible list (issue #323) so both
// paths produce identical row shapes.
const formatVerifiedProjectDonation = (item: GivethIoDonation) => {
  // Old donations dont have givbackFactor, so I use 0.5 for them
  const givbackFactor = item.givbackFactor || 0.75;

  // Use origin transaction data for swap donations (squid router)
  const isSwapDonation = !!item.swapTransaction;
  const txHash = isSwapDonation ? item.swapTransaction!.firstTxHash : item.transactionId;
  const amount = isSwapDonation ? String(item.swapTransaction!.fromAmount) : item.amount;
  const currency = isSwapDonation ? item.swapTransaction!.fromTokenSymbol : item.currency;
  const networkId = isSwapDonation ? item.swapTransaction!.fromChainId : item.transactionNetworkId;

  return {
    amount,
    currency,
    createdAt: moment(item.createdAt).format('YYYY-MM-DD-HH:mm:ss'),
    valueUsd: item.valueUsd,
    anonymous: item.anonymous,
    bottomRankInRound: item.bottomRankInRound,
    givbacksRound: item.powerRound,
    projectRank: item.projectRank,
    givbackFactor,
    valueUsdAfterGivbackFactor: donationValueAfterGivFactor({
      usdValue: item.valueUsd,
      givFactor: item.givbackFactor
    }),
    giverAddress: donationGiverAddress(item),
    txHash,
    network: getNetworkNameById(networkId),
    source: 'giveth.io',
    giverName: item && item.user && item.user.name,
    giverEmail: item && item.user && item.user.email,
    donorMasterName: composeDonorMasterName(item.user),
    projectLink: `https://giveth.io/project/${item.project.slug}`,
    isProjectGivbacksEligible: item.isProjectGivbackEligible,

    isReferrerGivbackEligible: item.isReferrerGivbackEligible,
    referrerWallet: item.referrerWallet,

    numberOfStreamedDonations: item.numberOfStreamedDonations,
    parentRecurringDonationId: item?.recurringDonation?.id,
    parentRecurringDonationTxHash: item?.recurringDonation?.txHash
  }
}

const getV6EligibleDonations = async (
  params: {
    beginDate: string,
    endDate: string,
    minEligibleValueUsd: number,
    givethCommunityProjectSlug: string,
    niceWhitelistTokens?: string[],
    niceProjectSlugs?: string[],
    includeIneligible?: boolean,
  }): Promise<FormattedDonation[]> => {
  if (!givethV6CoreApiUrl || !givethV6CoreApiPassword) {
    console.log('Skipping v6 Core donations: missing GIVETH_V6_CORE_API_URL or POWER_SYNC_PASSWORD')
    return []
  }

  let response
  try {
    response = await axios.get(
      `${givethV6CoreApiUrl.replace(/\/$/, '')}/api/internal/givbacks/donations`,
      {
        headers: {
          [givethV6CoreApiPasswordHeader]: givethV6CoreApiPassword,
        },
        params: {
          fromDate: params.beginDate,
          toDate: params.endDate,
          minEligibleValueUsd: params.minEligibleValueUsd,
          givethCommunityProjectSlug: params.givethCommunityProjectSlug,
          ...(params.niceWhitelistTokens?.length
            ? { niceWhitelistTokens: params.niceWhitelistTokens.join(',') }
            : {}),
          ...(params.niceProjectSlugs?.length
            ? { niceProjectSlugs: params.niceProjectSlugs.join(',') }
            : {}),
          ...(params.includeIneligible ? { includeIneligible: 'true' } : {}),
        },
        timeout: givethV6CoreApiTimeoutMs,
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // v6 Core is configured but unreachable. Throw instead of returning [] so the
    // GIVbacks calculations/exports never silently undercount on a v5-only
    // dataset; callers surface this as an error and the run can be retried.
    throw new Error(`Failed to fetch v6 Core donations: ${message}`)
  }

  const rows = response?.data?.data
  if (!Array.isArray(rows)) {
    return []
  }

  return rows.map((row: FormattedDonation) => ({
    ...row,
    giverName: row.giverName || '',
    giverEmail: row.giverEmail || '',
    // v6 Core reports its own eligibility; default to true for back-compat with
    // the existing eligible-only feed where the flag is omitted.
    isDonationGivbacksEligible: row.isDonationGivbacksEligible !== false,
    isReferrerGivbackEligible: Boolean(row.isReferrerGivbackEligible),
    referrerWallet: row.referrerWallet || undefined,
  }))
}

/**
 * Fetches the current GIV/USD price from v6 Core's internal endpoint, which
 * proxies BlockchainService.getTokenPrice (the same CoinGecko-backed source
 * that sets donation.priceUsd). Used by the GIVbacks round export (issue #323)
 * instead of CryptoCompare. Reuses the same auth/connectivity as the donations
 * feed — no new env var.
 *
 * Returns undefined when v6 Core is not configured (so the caller can surface
 * the &givPrice= override guidance). Throws on a configured-but-failing call or
 * an invalid price.
 */
export const getGivPriceFromV6Core = async (): Promise<number | undefined> => {
  if (!givethV6CoreApiUrl || !givethV6CoreApiPassword) {
    return undefined
  }

  const response = await axios.get(
    `${givethV6CoreApiUrl.replace(/\/$/, '')}/api/internal/givbacks/giv-price`,
    {
      headers: {
        [givethV6CoreApiPasswordHeader]: givethV6CoreApiPassword,
      },
      timeout: givethV6CoreApiTimeoutMs,
    },
  )

  const priceUsd = Number(response?.data?.data?.priceUsd)
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw new Error('v6 Core returned an invalid GIV price')
  }
  return priceUsd
}

/**
 * GIVbacks round export (issue #323) data source: returns every donation in the
 * window from BOTH v5 (giveth.io) and v6 Core, each tagged with
 * `isDonationGivbacksEligible`. When `includeIneligible` is false only eligible
 * donations are returned (same set the existing calculator uses).
 */
export const getGivbacksRoundDonations = async (
  params: {
    beginDate: string,
    endDate: string,
    minEligibleValueUsd: number,
    givethCommunityProjectSlug: string,
  },
  includeIneligible: boolean,
): Promise<FormattedDonation[]> => {
  // Single v6 Core fetch. Splitting buckets locally avoids two HTTP calls
  // and the eligibility drift that could otherwise occur if a donation
  // completed between calls (issue #323; previously called v6 once for
  // eligible + once for all). getEligibleDonations is v5-only, so we fetch and
  // merge v6 Core ourselves below — this is the one path that combines v5 + v6.
  const v5EligibleP = getEligibleDonations({
    ...params,
    eligible: true,
    enforceTokenEligibility: true,
  })
  const v6DonationsP = getV6EligibleDonations({
    ...params,
    includeIneligible,
  })

  const v5IneligibleP = includeIneligible
    ? getEligibleDonations({
        ...params,
        eligible: false,
        includeBelowMinDonations: true,
        enforceTokenEligibility: true,
      })
    : Promise.resolve<FormattedDonation[]>([])

  // Issue #323: v5's filterDonationsWithPurpleList only knows about
  // impact-graph's purple list. A donor added directly to v6 Core's purple
  // list (via project address or GIVbacks-eligibility-form) won't be
  // recognized by v5's filter, so their v5 (or v5-mirror) donations sneak
  // through as eligible. Fetch v6's purple list here so we can cross-check
  // every v5 row against it below. Soft-fails to an empty set when v6 Core
  // is unreachable.
  const v6PurpleListP = getPurpleListAddressSet()

  const [v5Eligible, v6Donations, v5Ineligible, v6PurpleAddresses] =
    await Promise.all([
      v5EligibleP,
      v6DonationsP,
      v5IneligibleP,
      v6PurpleListP,
    ])

  const isOnV6PurpleList = (donation: FormattedDonation): boolean => {
    const giver = (donation.giverAddress || '').trim().toLowerCase()
    return giver.length > 0 && v6PurpleAddresses.has(giver)
  }

  // Move v5 eligibles whose donor is on v6's purple list into the ineligible
  // bucket — they fail Lauren's added eligibility rule even though v5's own
  // filter let them through.
  const v5EligibleAfterV6Purple: FormattedDonation[] = []
  const v5PurpleListedDonations: FormattedDonation[] = []
  for (const donation of v5Eligible) {
    if (isOnV6PurpleList(donation)) {
      v5PurpleListedDonations.push(donation)
    } else {
      v5EligibleAfterV6Purple.push(donation)
    }
  }

  // v6 Core is the source of truth for donations made via the v6 stack. The
  // legacy data-sync cron mirrors most v6 donations back into v5 (impact-graph)
  // for backward compatibility, so a single donation typically appears in BOTH
  // sources. We pass v6 FIRST to mergeAndDedupeDonations so the v6 row wins
  // on a collision — that way the export's `source` column honestly reflects
  // where the donation originated, instead of always showing 'giveth.io'
  // because v5 happens to be loaded earlier. Scoped to /givbacks-round-report
  // only; the legacy /calculate-updated path keeps the v5-first behavior its
  // consumers already expect.
  const v6Eligible = v6Donations.filter(
    donation => donation.isDonationGivbacksEligible !== false,
  )
  const eligibleDonations = mergeAndDedupeDonations(
    v6Eligible,
    v5EligibleAfterV6Purple,
  ).map(donation => ({ ...donation, isDonationGivbacksEligible: true }))

  if (!includeIneligible) {
    return eligibleDonations
  }

  const v6Ineligible = v6Donations.filter(
    donation => donation.isDonationGivbacksEligible === false,
  )
  // Same v6-first ordering for the ineligible bucket. v5 donations whose
  // donor sits on v6's purple list are appended here too so the all-donations
  // export still surfaces them (tagged ineligible).
  const ineligibleDonations = [
    ...v6Ineligible,
    ...v5Ineligible,
    ...v5PurpleListedDonations,
  ].map(donation => ({ ...donation, isDonationGivbacksEligible: false }))

  // Eligible rows are passed first so they win on any tx/recurring key collision
  // (a donation must never appear as both eligible and ineligible).
  return mergeAndDedupeDonations(eligibleDonations, ineligibleDonations)
}

const normalizeDedupeValue = (value?: string | number): string => {
  return String(value || '').trim().toLowerCase()
}

const donationDedupeIdentifiers = (donation: FormattedDonation): string[] => {
  const identifiers: string[] = []
  if (donation.parentRecurringDonationId) {
    identifiers.push(
      `recurring:${normalizeDedupeValue(donation.parentRecurringDonationId)}`,
    )
  }

  const txHash = normalizeDedupeValue(donation.txHash)
  const network = normalizeDedupeValue(donation.network)
  if (txHash && network) {
    identifiers.push(`tx:${network}:${txHash}`)
  }

  return identifiers
}

const donationDedupeKey = (donation: FormattedDonation): string => {
  return donationDedupeIdentifiers(donation).join('|')
}

const preserveParentRecurringDonationTxHash = (
  target: FormattedDonation,
  source: FormattedDonation,
): void => {
  if (
    !target.parentRecurringDonationTxHash &&
    source.parentRecurringDonationTxHash
  ) {
    target.parentRecurringDonationTxHash =
      source.parentRecurringDonationTxHash
  }
}

export const mergeAndDedupeDonations = (
  donations: FormattedDonation[],
  additionalDonations: FormattedDonation[],
): FormattedDonation[] => {
  const donationsByKey = new Map<string, FormattedDonation>()
  const canonicalKeyByIdentifier = new Map<string, string>()

  for (const donation of donations.concat(additionalDonations)) {
    const key = donationDedupeKey(donation)
    const identifiers = donationDedupeIdentifiers(donation)
    const existingKey = identifiers
      .map(identifier => canonicalKeyByIdentifier.get(identifier))
      .find(Boolean)

    if (existingKey) {
      const existingDonation = donationsByKey.get(existingKey)
      const shouldPromoteIncomingDonation =
        Boolean(donation.parentRecurringDonationId) &&
        !existingDonation?.parentRecurringDonationId

      if (existingDonation) {
        preserveParentRecurringDonationTxHash(existingDonation, donation)
        preserveParentRecurringDonationTxHash(donation, existingDonation)
      }

      if (key && existingDonation && shouldPromoteIncomingDonation) {
        donationsByKey.delete(existingKey)
        donationsByKey.set(key, donation)
        const promotedIdentifiers = [
          ...donationDedupeIdentifiers(existingDonation),
          ...identifiers,
        ]
        promotedIdentifiers.forEach(identifier =>
          canonicalKeyByIdentifier.set(identifier, key),
        )
        continue
      }

      identifiers.forEach(identifier =>
        canonicalKeyByIdentifier.set(identifier, existingKey),
      )
      continue
    }

    if (key && !donationsByKey.has(key)) {
      donationsByKey.set(key, donation)
      identifiers.forEach(identifier =>
        canonicalKeyByIdentifier.set(identifier, key),
      )
    }
  }

  return Array.from(donationsByKey.values())
}

/**
 *
 * @returns {Promise<[{amount:400, currency:"GIV",createdAt:"",
 * valueUsd:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" ,
 * source:'giveth.io'}]>}
 * @param params
 */
export const getEligibleDonations = async (
  params: {
    beginDate: string,
    endDate: string,
    minEligibleValueUsd: number,
    givethCommunityProjectSlug: string,
    niceWhitelistTokens?: string[],
    niceProjectSlugs?: string[],
    eligible?: boolean,
    justCountListed?: boolean,
    includeBelowMinDonations?: boolean,
    enforceTokenEligibility?: boolean,
  }): Promise<FormattedDonation[]> => {
  try {
    const {
      beginDate,
      endDate,
      niceWhitelistTokens,
      niceProjectSlugs,
      // disablePurpleList,
      justCountListed,
      minEligibleValueUsd,
      givethCommunityProjectSlug,
      includeBelowMinDonations,
      enforceTokenEligibility,
    } = params
    const eligible = params.eligible === undefined ? true : params.eligible
    // Strict UTC parsing so the donation window matches the round-end price
    // block regardless of server timezone (issue #323).
    const timeFormat = 'YYYY/MM/DD-HH:mm:ss';
    const firstDate = moment.utc(beginDate, timeFormat, true);
    if (!firstDate.isValid()) {
      throw new Error('Invalid startDate')
    }
    const secondDate = moment.utc(endDate, timeFormat, true);

    if (!secondDate.isValid()) {
      throw new Error('Invalid endDate')
    }

    // givethio get time in this format YYYYMMDD HH:m:ss. Fetched in gateway-safe
    // sub-windows so a large (e.g. month-long) range doesn't 504 on the single
    // donations query (issue Giveth/giveth-dapps-v2#5569). `id` is selected so a
    // donation duplicated across a shared sub-window boundary can be deduped.
    const buildQuery = (fromQueryDate: string, toQueryDate: string) => gql`
        {
          donations(
              fromDate:"${fromQueryDate}",
              toDate:"${toQueryDate}"
          ) {
            id
            valueUsd
            createdAt
            currency
            transactionId
            transactionNetworkId
            amount
            givbackFactor
            chainType
            anonymous
            isProjectGivbackEligible
            isTokenEligibleForGivback
            projectRank
            powerRound
            bottomRankInRound
            isReferrerGivbackEligible
            referrerWallet
            recurringDonation {
             id
             txHash
            }
            swapTransaction {
              firstTxHash
              fromAmount
              fromTokenSymbol
              fromChainId
              fromTokenAddress
              toAmount
              toTokenSymbol
              toChainId
              toTokenAddress
              squidRequestId
              status
            }
            project {
              slug
              verified
              listed
              projectPower {
                powerRank
              }
            }
            user {
              name
              firstName
              lastName
              email
              walletAddress
            }
            fromWalletAddress
            status
          }
        }
    `;

    const rawDonations = await fetchGivethIoDonationsInWindows(
      beginDate,
      endDate,
      buildQuery,
    )
    const rawDonationsFilterByChain = groupDonationsByParentRecurringId(rawDonations)
    let donationsToVerifiedProjects: GivethIoDonation[] = rawDonationsFilterByChain
      .filter(
        (donation: GivethIoDonation) =>
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && isDonationAmountValid({
            donation,
            minEligibleValueUsd,
            givethCommunityProjectSlug,
          })
          && (donation.chainType == 'EVM' || isStellarDonationAndUserLoggedInWithEvmAddress(donation))
          && donation.isProjectGivbackEligible
          // Token GIVbacks eligibility (issue #323 AC #6). Opt-in so existing
          // calculator endpoints keep their current behavior; only the round
          // export enables it, matching the v6 Core rule.
          && (!enforceTokenEligibility || donation.isTokenEligibleForGivback)
          && donation.status === 'verified'
      )

    let donationsToNotVerifiedProjects: GivethIoDonation[] = rawDonationsFilterByChain
      .filter(
        (donation: GivethIoDonation) =>
        (
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && (donation.chainType == 'EVM' || isStellarDonationAndUserLoggedInWithEvmAddress(donation))
          && !donation.isProjectGivbackEligible
          && donation.status === 'verified'
        )
      )

    if (niceWhitelistTokens) {
      donationsToVerifiedProjects = donationsToVerifiedProjects
        .filter(
          (donation: GivethIoDonation) =>
            niceWhitelistTokens.includes(donation.currency))

      donationsToNotVerifiedProjects = donationsToNotVerifiedProjects
        .filter(
          (donation: GivethIoDonation) =>
            niceWhitelistTokens.includes(donation.currency)
        )
    }

    if (niceProjectSlugs) {
      donationsToVerifiedProjects = donationsToVerifiedProjects
        .filter(
          donation =>
            niceProjectSlugs.includes(donation.project.slug))

      donationsToNotVerifiedProjects = donationsToNotVerifiedProjects
        .filter(
          donation =>
            niceProjectSlugs.includes(donation.project.slug)
        )
    }

    if (justCountListed) {
      donationsToNotVerifiedProjects = donationsToNotVerifiedProjects
        .filter(
          donation =>
            donation.project.listed
        )
      donationsToVerifiedProjects = donationsToVerifiedProjects
        .filter(
          donation =>
            donation.project.listed
        )
    }
    const formattedDonationsToVerifiedProjects = donationsToVerifiedProjects.map(
      formatVerifiedProjectDonation,
    );

    const formattedDonationsToNotVerifiedProjects: FormattedDonation[] = donationsToNotVerifiedProjects.map(item => {
      const givbackFactor = item.givbackFactor || 0.5;

      // Use origin transaction data for swap donations (squid router)
      const isSwapDonation = !!item.swapTransaction;
      const txHash = isSwapDonation ? item.swapTransaction!.firstTxHash : item.transactionId;
      const amount = isSwapDonation ? String(item.swapTransaction!.fromAmount) : item.amount;
      const currency = isSwapDonation ? item.swapTransaction!.fromTokenSymbol : item.currency;
      const networkId = isSwapDonation ? item.swapTransaction!.fromChainId : item.transactionNetworkId;

      return {
        amount,
        anonymous: item.anonymous,
        currency,
        createdAt: moment(item.createdAt).format('YYYY-MM-DD-HH:mm:ss'),
        valueUsd: item.valueUsd,
        valueUsdAfterGivbackFactor: donationValueAfterGivFactor({
          usdValue: item.valueUsd,
          givFactor: item.givbackFactor
        }),
        givbackFactor,
        projectRank: item.projectRank,
        bottomRankInRound: item.powerRound,
        givbacksRound: item.powerRound,
        giverAddress: donationGiverAddress(item),
        txHash,
        network: getNetworkNameById(networkId),
        source: 'giveth.io',
        giverName: item && item.user && item.user.name,
        giverEmail: item && item.user && item.user.email,
        donorMasterName: composeDonorMasterName(item.user),
        projectLink: `https://giveth.io/project/${item.project.slug}`,
        isProjectGivbacksEligible: item.isProjectGivbackEligible,

        isReferrerGivbackEligible: item.isReferrerGivbackEligible,
        referrerWallet: item.referrerWallet,

        parentRecurringDonationId: item?.recurringDonation?.id,
        parentRecurringDonationTxHash: item?.recurringDonation?.txHash
      }
    });
    // Donations to GIVbacks-eligible projects that pass the base checks but fail
    // donation-level eligibility (below the minimum USD threshold, or — when
    // enforced — a non-eligible token). They are genuinely ineligible, but the
    // verified filter above drops them, so the default "all donations" export
    // would miss them. Included only when explicitly requested (issue #323 audit
    // mode) so existing eligible/not-eligible endpoints are unaffected.
    let ineligibleVerifiedProjectDonations: FormattedDonation[] = []
    if (includeBelowMinDonations) {
      let extras = rawDonationsFilterByChain.filter(
        (donation: GivethIoDonation) =>
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && (donation.chainType == 'EVM' || isStellarDonationAndUserLoggedInWithEvmAddress(donation))
          && donation.isProjectGivbackEligible
          && donation.status === 'verified'
          // Not eligible at the donation level: fails the amount minimum, or
          // (when enforced) the token is not GIVbacks-eligible.
          && !(
            isDonationAmountValid({
              donation,
              minEligibleValueUsd,
              givethCommunityProjectSlug,
            })
            && (!enforceTokenEligibility || donation.isTokenEligibleForGivback)
          ),
      )
      if (niceWhitelistTokens) {
        extras = extras.filter(donation =>
          niceWhitelistTokens.includes(donation.currency),
        )
      }
      if (niceProjectSlugs) {
        extras = extras.filter(donation =>
          niceProjectSlugs.includes(donation.project.slug),
        )
      }
      if (justCountListed) {
        extras = extras.filter(donation => donation.project.listed)
      }
      ineligibleVerifiedProjectDonations = extras.map(
        formatVerifiedProjectDonation,
      )
    }

    const eligibleDonations = await filterDonationsWithPurpleList(formattedDonationsToVerifiedProjects)
    const notEligibleDonations = (
      await purpleListDonations(formattedDonationsToVerifiedProjects)
    ).concat(formattedDonationsToNotVerifiedProjects, ineligibleVerifiedProjectDonations)
    const eligibleDonationKeys = new Set(
      eligibleDonations.flatMap(donation => donationDedupeIdentifiers(donation)),
    )
    const commonDonations = notEligibleDonations.filter(donation =>
      donationDedupeIdentifiers(donation).some(key =>
        eligibleDonationKeys.has(key),
      ),
    )


    console.log('donations length', {
      eligibleDonations: eligibleDonations.length,
      notEligibleDonations: notEligibleDonations.length,

      // It should be zero
      commonDonations: commonDonations.length
    })
    if (!eligible) {
      return notEligibleDonations
    }

    // v5-only. The legacy GIVbacks endpoints (/calculate, /calculate-updated,
    // /eligible-donations, /not-eligible-donations, /eligible-donations-for-nice-token)
    // are an unchanged March-2026 reference and must NOT pull in v6 Core
    // donations (issue Giveth/giveth-dapps-v2#5569 — Ashley's workflow). The new
    // combined v5+v6 system lives in /givbacks-round-report, which fetches and
    // merges v6 Core itself (see getGivbacksRoundDonations / getV6EligibleDonations).
    return eligibleDonations


  } catch (e) {
    console.log('getEligibleDonations() error', {
      error: e,
      params
    })
    throw e
  }
}

export const getVerifiedPurpleListDonations = async (beginDate: string, endDate: string) => {
  try {
    const timeFormat = 'YYYY/MM/DD-HH:mm:ss';
    const firstDate = moment(beginDate, timeFormat);
    if (String(firstDate) === 'Invalid date') {
      throw new Error('Invalid startDate')
    }
    const secondDate = moment(endDate, timeFormat);

    if (String(secondDate) === 'Invalid date') {
      throw new Error('Invalid endDate')
    }
    // givethio get time in this format YYYYMMDD HH:m:ss. Fetched in gateway-safe
    // sub-windows so a large range doesn't 504 on the single donations query
    // (issue Giveth/giveth-dapps-v2#5569). `id` is selected so a donation
    // duplicated across a shared sub-window boundary can be deduped.
    const buildQuery = (fromQueryDate: string, toQueryDate: string) => gql`
        {
          donations(
              fromDate:"${fromQueryDate}",
              toDate:"${toQueryDate}"
          ) {
            id
            valueUsd
            createdAt
            currency
            transactionId
            transactionNetworkId
            amount
            chainType
            isProjectGivbackEligible
            swapTransaction {
              firstTxHash
              fromAmount
              fromTokenSymbol
              fromChainId
              fromTokenAddress
              toAmount
              toTokenSymbol
              toChainId
              toTokenAddress
              squidRequestId
              status
            }
            project {
              slug
              verified
            }
            user {
              name
              email
            }
            fromWalletAddress
            status
          }
        }
    `;

    const rawDonations = await fetchGivethIoDonationsInWindows(
      beginDate,
      endDate,
      buildQuery,
    )
    let donationsToVerifiedProjects = rawDonations
      .filter(
        (donation: GivethIoDonation) =>
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && (donation.chainType == 'EVM' || isStellarDonationAndUserLoggedInWithEvmAddress(donation))
          && donation.isProjectGivbackEligible
          && donation.status === 'verified'
      )


    const formattedDonationsToVerifiedProjects = donationsToVerifiedProjects.map((item: GivethIoDonation) => {
      // Use origin transaction data for swap donations (squid router)
      const isSwapDonation = !!item.swapTransaction;
      const txHash = isSwapDonation ? item.swapTransaction!.firstTxHash : item.transactionId;
      const amount = isSwapDonation ? String(item.swapTransaction!.fromAmount) : item.amount;
      const currency = isSwapDonation ? item.swapTransaction!.fromTokenSymbol : item.currency;
      const networkId = isSwapDonation ? item.swapTransaction!.fromChainId : item.transactionNetworkId;

      return {
        amount,
        currency,
        createdAt: moment(item.createdAt).format('YYYY-MM-DD-HH:mm:ss'),
        valueUsd: item.valueUsd,
        givbackFactor: item.givbackFactor,
        anonymous: item.anonymous,
        giverAddress: donationGiverAddress(item),
        txHash,
        network: getNetworkNameById(networkId),
        source: 'giveth.io',
        giverName: item && item.user && item.user.name,
        giverEmail: item && item.user && item.user.email,
        projectLink: `https://giveth.io/project/${item.project.slug}`,
      }
    });

    return await purpleListDonations(formattedDonationsToVerifiedProjects)

  } catch (e) {
    console.log('getEligibleDonations() error', {
      error: e,
      beginDate, endDate
    })
    throw e
  }
}

export const getDonationsReport = async (params: {
  // example: 2021/07/01-00:00:00
  beginDate: string,
  endDate: string,
  minEligibleValueUsd: number,
  givethCommunityProjectSlug: string,
  niceWhitelistTokens?: string[],
  niceProjectSlugs?: string[],
  applyChainvineReferral?: boolean,
}): Promise<MinimalDonation[]> => {
  const {
    beginDate,
    endDate,
    niceWhitelistTokens,
    niceProjectSlugs,
    applyChainvineReferral,
    givethCommunityProjectSlug,
    minEligibleValueUsd
  } = params
  try {

    const response = await getEligibleDonations(
      {
        beginDate, endDate,
        niceWhitelistTokens,
        niceProjectSlugs,
        minEligibleValueUsd,
        givethCommunityProjectSlug,
      })


    let donations: FormattedDonation[] = []
    if (!applyChainvineReferral) {
      donations = response
    } else {
      for (const donation of response) {
        if (donation.isReferrerGivbackEligible && donation.referrerWallet) {
          // We split givback reward between giver and referrer
          donations.push(
            {
              ...donation,
              valueUsd: donation.valueUsd - calculateReferralReward(donation.valueUsd),
              referred: true
            },
            {
              ...donation,
              referrer: true,
              valueUsd: calculateReferralReward(donation.valueUsd),
              giverAddress: donation.referrerWallet,
              giverEmail: response.find(d => d.giverAddress === donation.referrerWallet)?.giverEmail || '',
              giverName: response.find(d => d.giverAddress === donation.referrerWallet)?.giverName || 'Referrer donor',
            }
          )
        } else {
          donations.push(donation)
        }
      }
    }
    console.log('**donations length**', donations.length)
    const groups = _.groupBy(donations, 'giverAddress')
    return _.map(groups, (value: FormattedDonation[], key: string) => {

      const result = {
        giverName: value[0].giverName,
        giverEmail: value[0].giverEmail,
        giverAddress: key.toLowerCase(),
        totalDonationsUsdValue: _.reduce(value, function (total: number, o: FormattedDonation) {
          return total + o.valueUsd;
        }, 0),
        totalDonationsUsdValueAfterGivFactor: _.reduce(value, function (total: number, o: FormattedDonation) {
          return total + donationValueAfterGivFactor({
            usdValue: o.valueUsd,
            givFactor: o.givbackFactor
          });
        }, 0),

        totalReferralAddedUsdValue: _.reduce(value, function (total: number, o: FormattedDonation) {
          return o.referrer ? total + o.valueUsd : total
        }, 0),
        totalReferralAddedUsdValueAfterGivFactor: _.reduce(value, function (total: number, o: FormattedDonation) {
          return o.referrer ? total + donationValueAfterGivFactor({
            usdValue: o.valueUsd,
            givFactor: o.givbackFactor
          }) : total;
        }, 0),

        totalReferralDeductedUsdValue: _.reduce(value, function (total: number, o: FormattedDonation) {
          return o.referred ? total + calculateReferralRewardFromRemainingAmount(o.valueUsd) : total;
        }, 0),
        totalReferralDeductedUsdValueAfterGivFactor: _.reduce(value, function (total: number, o: FormattedDonation) {
          return o.referred ? total + donationValueAfterGivFactor({
            usdValue: calculateReferralRewardFromRemainingAmount(o.valueUsd),
            givFactor: o.givbackFactor
          }) : total;
        }, 0),
      }
      return result;
    });

  } catch (e) {
    console.log('error in getting givethio donations', e)
    throw e
  }
}

const getProjectsSortByRank = async (limit: number, offset: number): Promise<Project[]> => {
  const query = gql`
          query{  
            projects(
              limit: ${limit}
              skip: ${offset}
            ) {
              projects {
                id
                title
                slug
                verified
                projectPower {
                  totalPower
                  powerRank
                  round
                }
              }
              totalCount
            }
           }
           
    `;

  try {
    const result = await request(`${givethiobaseurl}/graphql`, query)
    return result.projects.projects.map((project: Project) => {
      project.link = `${process.env.GIVETHIO_DAPP_URL}/project/${project.slug}`
      return project
    })
  } catch (e) {
    console.log('getProjectsSortByRank error', e, givethiobaseurl)
    throw new Error('Error in getting getProjectsSortByRank from impact-graph')
  }
}
export const getAllProjectsSortByRank = async (): Promise<Project[]> => {
  const limit = 50
  let offset = 0
  let projects: Project[] = []
  try {
    let stillFetch = true
    while (stillFetch) {
      const result = await getProjectsSortByRank(limit, offset)
      projects = projects.concat(result)
      if (result.length === 0) {
        stillFetch = false
      }
      if (result[result.length - 1].projectPower.totalPower === 0) {
        stillFetch = false
      }
      offset += result.length
    }
    return projects
  } catch (e) {
    console.log('getAllProjectsSortByRank error', e)
    throw new Error('Error in getting getAllProjectsSortByRank from impact-graph')
  }
}

export const getStartTime = async (retries = 5): Promise<number> => {
  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const startTime = await tokenDistroGC.startTime();
      console.log('startTime', startTime);
      return Number(startTime) as number;
    } catch (e) {
      console.log(`Error in getting startTime, attempt ${i + 1}`, e);
      lastError = e;
    }
  }
  console.log('All attempts failed', lastError);
  throw new Error('Error in getting startTime');
}

export const getGIVbacksRound = async (round: number): Promise<GIVbacksRound> => {
  let roundStartDate: Date;
  let roundEndDate: Date;
  const startTime = await getStartTime();
  const startDate = new Date(startTime * 1000);
  const afterRound20 = startDate.getMilliseconds() + ROUND_20_OFFSET;
  if (round < 1) {
    throw new Error('Invalid round number')

  } else if (round < 20) {
    roundStartDate = new Date(startDate.getTime() + (round - 1) * twoWeeksInMilliseconds);
    roundEndDate = new Date(startDate.getTime() + round * twoWeeksInMilliseconds - 1000);
  } else {
    roundStartDate = new Date(startDate.getTime() + (round - 1) * twoWeeksInMilliseconds + afterRound20);
    roundEndDate = new Date(startDate.getTime() + round * twoWeeksInMilliseconds + afterRound20 - 1000);
  }

  const start = moment(roundStartDate).format('YYYY/MM/DD-HH:mm:ss')
  const end = moment(roundEndDate).format('YYYY/MM/DD-HH:mm:ss');

  console.log('getGIVbacksRound result', {
    round,
    start, end
  })
  return {
    round,
    start,
    end
  }
}

export const getCurrentGIVbacksRound = async (): Promise<GIVbacksRound> => {
  const now = new Date().getTime();
  const startTime = await getStartTime();
  const startDate = new Date(startTime * 1000);
  startDate.setTime(startDate.getTime() + ROUND_20_OFFSET);
  const deltaT = now - startDate.getTime();
  const _round = Math.floor(deltaT / twoWeeksInMilliseconds) + 1;
  return getGIVbacksRound(_round)
}


