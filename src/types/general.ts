import moment from "moment";

export interface FormattedDonation {
    amount: string,
    currency:string,
    createdAt:string,
    valueUsd: string,
    giverAddress: string,
    txHash: string,
    network: string,
    source: string,
    giverName: string
    giverEmail ?: string,
    projectLink ?: string,
    niceTokens ?:string,
    info?:string,
}

export interface GivethIoDonation {
    amount: string,
    currency:string,
    createdAt:string,
    valueUsd: string,
    giverAddress: string,
    transactionId: string,
    transactionNetworkId: number,
    fromWalletAddress: string,
    toWalletAddress:string
    source: string,
    user :{
        name: string,
        email : string
    }
    project:{
        slug:string
        listed: boolean,
        verified: boolean
    }
    // giverName: string
    // giverEmail: string,
    status: string,
    isProjectVerified: boolean,
}

export interface DonationResponse {
    giverAddress: string,
    giverEmail: string,
    giverName: string,
    totalDonationsUsdValue: string,
    givback:number,
    givbackUsdValue ?: string,
    share: number,
    niceEarned: number
}

export interface MinimalDonation {
    giverAddress: string,
    giverEmail: string,
    giverName: string,
    valueUsd:string,
    niceTokens ?:number,
    share ?:number,
    totalDonationsUsdValue:number
}

export interface TraceDonation {
    amount: string,
    token: string,
    createdAt: string,
    usdValue: string,
    giverAddress: string,
    homeTxHash: string,
    projectInfo :{
        type:string,
        title:string
    }
}
