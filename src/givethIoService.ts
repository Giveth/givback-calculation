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
  // eligible + once for all).
  const v5EligibleP = getEligibleDonations({
    ...params,
    eligible: true,
    enforceTokenEligibility: true,
    skipV6Fetch: true,
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

  const [v5Eligible, v6Donations, v5Ineligible] = await Promise.all([
    v5EligibleP,
    v6DonationsP,
    v5IneligibleP,
  ])

  const v6Eligible = v6Donations.filter(
    donation => donation.isDonationGivbacksEligible !== false,
  )
  const eligibleDonations = mergeAndDedupeDonations(v5Eligible, v6Eligible)
    .map(donation => ({ ...donation, isDonationGivbacksEligible: true }))

  if (!includeIneligible) {
    return eligibleDonations
  }

  const v6Ineligible = v6Donations.filter(
    donation => donation.isDonationGivbacksEligible === false,
  )
  const ineligibleDonations = [
    ...v5Ineligible,
    ...v6Ineligible,
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
    // When true, skip the v6 Core fetch and return v5-only data. Set by the
    // round-export orchestrator (issue #323) which fetches v6 itself ONCE
    // and merges the buckets locally — avoids two HTTP round-trips against
    // v6 Core and the eligible/ineligible drift that can occur between them.
    skipV6Fetch?: boolean,
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
      skipV6Fetch,
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

    // givethio get time in this format YYYYMMDD HH:m:ss
    const fromDate = toGivethIoQueryDate(beginDate, 'startDate')
    const toDate = toGivethIoQueryDate(endDate, 'endDate')
    const query = gql`
        {
          donations(
              fromDate:"${fromDate}", 
              toDate:"${toDate}"
          ) {
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

    const result = await request(`${givethiobaseurl}/graphql`, query)
    const rawDonationsFilterByChain = groupDonationsByParentRecurringId(result.donations)
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

    // Caller (e.g. round export) is fetching v6 itself; return v5-only.
    if (skipV6Fetch) {
      return eligibleDonations
    }

    const v6EligibleDonations = await getV6EligibleDonations({
      beginDate,
      endDate,
      niceWhitelistTokens,
      niceProjectSlugs,
      minEligibleValueUsd,
      givethCommunityProjectSlug,
    })

    return mergeAndDedupeDonations(eligibleDonations, v6EligibleDonations)


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
    // givethio get time in this format YYYYMMDD HH:m:ss
    const fromDate = toGivethIoQueryDate(beginDate, 'startDate')
    const toDate = toGivethIoQueryDate(endDate, 'endDate')
    const query = gql`
        {
          donations(
              fromDate:"${fromDate}", 
              toDate:"${toDate}"
          ) {
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

    const result = await request(`${givethiobaseurl}/graphql`, query)
    const rawDonations = result.donations
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


