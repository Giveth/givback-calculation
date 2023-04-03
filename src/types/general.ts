import moment from "moment";

export interface FormattedDonation {
    amount: string,
    currency: string,
    createdAt: string,
    valueUsd: number,
    givbackFactor: number,
    projectRank ?: number,
    bottomRankInRound ?: number,
    givbacksRound ?: number,
    giverAddress: string,
    txHash: string,
    network: string,
    source: string,
    giverName: string
    giverEmail?: string,
    projectLink?: string,
    niceTokens?: string,
    info?: string,

    isReferrerGivbackEligible ?:boolean,
    referrerWallet ?:string
    referrer ?: boolean,
    referred ?: boolean
}

export interface GivethIoDonation {
    amount: string,
    currency: string,
    createdAt: string,
    valueUsd: number,
    givbackFactor: number,
    projectRank ?: number,
    powerRound ?: number,
    bottomRankInRound ?: number,
    giverAddress: string,
    transactionId: string,
    transactionNetworkId: number,
    fromWalletAddress: string,
    toWalletAddress: string
    source: string,
    user: {
        name: string,
        email: string
    }
    project: {
        slug: string
        listed: boolean,
        verified: boolean,
        projectPower: {
            powerRank: number
        }
    }

    // giverName: string
    // giverEmail: string,
    status: string,
    isProjectVerified: boolean,
    isReferrerGivbackEligible ?:boolean,
    referrerWallet ?:string
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
    niceEarned: number

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
    link ?: string,
    projectPower: {
        totalPower: number,
        powerRank: number,
        round: number
    }
}
