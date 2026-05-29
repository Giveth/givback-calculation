export interface FormattedDonation {
  amount: string,
  currency: string,
  createdAt: string,
  valueUsd: number,
  givbackFactor: number,
  projectRank?: number,
  bottomRankInRound?: number,
  givbacksRound?: number,
  giverAddress: string,
  txHash: string,
  network: string,
  source: string,
  giverName: string
  giverEmail?: string,
  donorMasterName?: string,
  projectLink?: string,
  niceTokens?: string,
  info?: string,
  isReferrerGivbackEligible?: boolean,
  referrerWallet?: string
  referrer?: boolean,
  referred?: boolean,
  anonymous: boolean,
  parentRecurringDonationId?: string,
  parentRecurringDonationTxHash?: string,
  valueUsdAfterGivbackFactor?: number,
  // GIVbacks round export (issue #323) fields:
  txLink?: string,
  isDonationGivbacksEligible?: boolean,
  isProjectGivbacksEligible?: boolean,
  raffleTicketsPerDonation?: number,
  raffleTicketsPerDonorTotal?: number,
}

export interface GivethIoDonation {
  amount: string,
  currency: string,
  createdAt: string,
  valueUsd: number,
  givbackFactor: number,
  projectRank?: number,
  powerRound?: number,
  bottomRankInRound?: number,
  giverAddress: string,
  transactionId: string,
  transactionNetworkId: number,
  fromWalletAddress: string,
  toWalletAddress: string
  chainType: string
  source: string,
  user: {
    name: string,
    firstName?: string,
    lastName?: string,
    email: string,
    walletAddress: string
  }

  recurringDonation?: {
    id: string,
    txHash: string
  }
  project: {
    slug: string
    listed: boolean,
    verified: boolean,
    projectPower: {
      powerRank: number
    }
  }

  swapTransaction?: {
    firstTxHash: string,
    fromAmount: number,
    fromTokenSymbol: string,
    fromChainId: number,
    fromTokenAddress: string,
    toAmount: number,
    toTokenSymbol: string,
    toChainId: number,
    toTokenAddress: string,
    squidRequestId?: string,
    status: string
  }

  // giverName: string
  // giverEmail: string,
  status: string,
  anonymous: boolean,
  isProjectGivbackEligible: boolean,
  isReferrerGivbackEligible?: boolean,
  referrerWallet?: string
  numberOfStreamedDonations?: number
}

export interface DonationResponse {
  giverAddress: string,
  giverEmail: string,
  giverName: string,
  totalDonationsUsdValue?: number,
  totalDonationsUsdValueAfterGivFactor: number,
  givback: number,
  givbackUsdValue?: string,
  share: number,
  niceEarned?: number

  totalReferralDeductedUsdValue?: number
  totalReferralDeductedUsdValueAfterGivFactor?: number

  totalReferralAddedUsdValue?: number
  totalReferralAddedUsdValueAfterGivFactor?: number
}

export interface MinimalDonation {
  giverAddress: string,
  giverEmail: string,
  giverName: string,
  valueUsd: string,
  niceTokens?: number,
  share?: number,
  totalDonationsUsdValue: number
  totalDonationsUsdValueAfterGivFactor: number

  totalReferralDeductedUsdValue?: number
  totalReferralDeductedUsdValueAfterGivFactor?: number

  totalReferralAddedUsdValue?: number
  totalReferralAddedUsdValueAfterGivFactor?: number
}

export interface GivbackFactorParams {
  topPowerRank: number;
  minimumFactor: number;
  maximumFactor: number;
}

export interface Project {
  id: string,
  title: string,
  slug: string,
  verified: boolean,
  link?: string,
  projectPower: {
    totalPower: number,
    powerRank: number,
    round: number
  }

}

export interface GIVbacksRound {
  round: number,
  start: string,
  end: string
}

export interface PurpleListExportRow {
  address: string,
  network: string | null,
  source: 'projectRecipientAddress' | 'givbacksEligibilityForm',
  projectLink: string | null,
}
