import { FormattedDonation } from './types/general'
import { getTransactionLink } from './utils'

const { parse } = require('json2csv')

const ROUND_DECIMALS = 7

export interface GivbacksRoundReportSummary {
  roundStartTime: string
  roundEndTime: string
  givPrice: number
  maxPrizePool: number
  // sum(valueUsdAfterGivbackFactor of eligible donations) / givPrice, in GIV.
  calculatedPrizePool: number
  // min(calculatedPrizePool, maxPrizePool), in GIV.
  actualPrizePool: number
  totalEligibleDonations: number
  totalEligibleDonors: number
  // Equal to calculatedPrizePool (sum of all eligible raffle tickets).
  totalRaffleTickets: number
}

export interface GivbacksRoundReport {
  summary: GivbacksRoundReportSummary
  donations: FormattedDonation[]
}

const roundNumber = (value: number): number =>
  Number(value.toFixed(ROUND_DECIMALS))

const normalizeAddress = (address?: string): string =>
  (address || '').trim().toLowerCase()

// v6 Core tags rows with source 'giveth-v6-core'; everything else is v5.
const resolveSourceLabel = (donation: FormattedDonation): 'v5' | 'v6' =>
  (donation.source || '').toLowerCase().includes('v6') ? 'v6' : 'v5'

const resolveValueUsdAfterGivbackFactor = (
  donation: FormattedDonation,
): number => {
  if (
    typeof donation.valueUsdAfterGivbackFactor === 'number' &&
    Number.isFinite(donation.valueUsdAfterGivbackFactor)
  ) {
    return donation.valueUsdAfterGivbackFactor
  }
  const valueUsd = Number(donation.valueUsd) || 0
  const givbackFactor = Number(donation.givbackFactor) || 0
  return roundNumber(valueUsd * givbackFactor)
}

/**
 * Computes raffle tickets, per-donor totals, and the prize pool for a GIVbacks
 * round. A single round-end GIV price is used for both raffle tickets and the
 * prize pool, which keeps `totalRaffleTickets === calculatedPrizePool` (issue
 * #323). Ineligible donations always get 0 raffle tickets.
 */
export const buildGivbacksRoundReport = (params: {
  donations: FormattedDonation[]
  givPrice: number
  maxPrizePool: number
  roundStartTime: string
  roundEndTime: string
}): GivbacksRoundReport => {
  const { donations, givPrice, maxPrizePool, roundStartTime, roundEndTime } =
    params

  if (!Number.isFinite(givPrice) || givPrice <= 0) {
    throw new Error('Invalid GIV price for round report')
  }

  const ticketsByDonor = new Map<string, number>()
  let calculatedPrizePool = 0
  let totalEligibleDonations = 0
  const eligibleDonors = new Set<string>()

  for (const donation of donations) {
    const isEligible = donation.isDonationGivbacksEligible === true
    const valueUsdAfterGivbackFactor =
      resolveValueUsdAfterGivbackFactor(donation)
    donation.valueUsdAfterGivbackFactor = valueUsdAfterGivbackFactor

    const raffleTicketsPerDonation = isEligible
      ? roundNumber(valueUsdAfterGivbackFactor / givPrice)
      : 0
    donation.raffleTicketsPerDonation = raffleTicketsPerDonation
    donation.txLink = getTransactionLink(donation.network, donation.txHash)

    if (isEligible) {
      const donorKey = normalizeAddress(donation.giverAddress)
      totalEligibleDonations += 1
      eligibleDonors.add(donorKey)
      calculatedPrizePool += raffleTicketsPerDonation
      ticketsByDonor.set(
        donorKey,
        (ticketsByDonor.get(donorKey) ?? 0) + raffleTicketsPerDonation,
      )
    }
  }

  for (const donation of donations) {
    const donorKey = normalizeAddress(donation.giverAddress)
    donation.raffleTicketsPerDonorTotal = roundNumber(
      ticketsByDonor.get(donorKey) ?? 0,
    )
  }

  calculatedPrizePool = roundNumber(calculatedPrizePool)
  const actualPrizePool = roundNumber(Math.min(calculatedPrizePool, maxPrizePool))

  return {
    summary: {
      roundStartTime,
      roundEndTime,
      givPrice,
      maxPrizePool,
      calculatedPrizePool,
      actualPrizePool,
      totalEligibleDonations,
      totalEligibleDonors: eligibleDonors.size,
      totalRaffleTickets: calculatedPrizePool,
    },
    donations,
  }
}

// Exact column set and order required by issue #323.
const ROUND_DONATIONS_CSV_FIELDS = [
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
]

export const buildRoundDonationCsvRows = (
  donations: FormattedDonation[],
): Record<string, unknown>[] =>
  donations.map(donation => ({
    txLink: donation.txLink ?? '',
    donorMasterName: donation.donorMasterName ?? '',
    amount: donation.amount,
    currency: donation.currency,
    createdAt: donation.createdAt,
    valueUsd: donation.valueUsd,
    anonymous: Boolean(donation.anonymous),
    givbackFactor: donation.givbackFactor,
    valueUsdAfterGivbackFactor: donation.valueUsdAfterGivbackFactor ?? 0,
    giverAddress: donation.giverAddress,
    txHash: donation.txHash,
    network: donation.network,
    source: resolveSourceLabel(donation),
    giverName: donation.giverName ?? '',
    giverEmail: donation.giverEmail ?? '',
    projectLink: donation.projectLink ?? '',
    parentRecurringDonationTxHash: donation.parentRecurringDonationTxHash ?? '',
    isDonationGivbacksEligible: donation.isDonationGivbacksEligible === true,
    isProjectGivbacksEligible: donation.isProjectGivbacksEligible === true,
    raffleTicketsPerDonation: donation.raffleTicketsPerDonation ?? 0,
    raffleTicketsPerDonorTotal: donation.raffleTicketsPerDonorTotal ?? 0,
  }))

export const parseRoundDonationsCsv = (
  donations: FormattedDonation[],
): string =>
  parse(buildRoundDonationCsvRows(donations), {
    fields: ROUND_DONATIONS_CSV_FIELDS,
  })
