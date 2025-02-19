import {
  FormattedDonation,
  GivbackFactorParams,
  GivethIoDonation,
  MinimalDonation,
  Project,
  GIVbacksRound
} from "./types/general";
import {GIVETH_TOKEN_DISTRO_ADDRESS} from "./subgraphService";
import TokenDistroJSON from '../abi/TokenDistroV2.json'

const Ethers = require("ethers");
const {isAddress} = require("ethers");

require('dotenv').config()

const {gql, request} = require('graphql-request');
const moment = require('moment')
const _ = require('underscore')

import {
  donationValueAfterGivFactor,
  filterDonationsWithPurpleList, groupDonationsByParentRecurringId,
  purpleListDonations
} from './commonServices'
import {
  calculateReferralRewardFromRemainingAmount,
  calculateReferralReward,
  getNetworkNameById,
  isDonationAmountValid
} from "./utils";

const givethiobaseurl = process.env.GIVETHIO_BASE_URL
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
      givethCommunityProjectSlug
    } = params
    const eligible = params.eligible === undefined ? true : params.eligible
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
    const fromDate = beginDate.split('/').join('').replace('-', ' ')
    const toDate = endDate.split('/').join('').replace('-', ' ')
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
            projectRank
            powerRound
            bottomRankInRound
            isReferrerGivbackEligible
            referrerWallet
            recurringDonation {
             id
             txHash
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
    const formattedDonationsToVerifiedProjects = donationsToVerifiedProjects.map(item => {
      // Old donations dont have givbackFactor, so I use 0.5 for them
      const givbackFactor = item.givbackFactor || 0.75;
      return {
        amount: item.amount,
        currency: item.currency,
        createdAt: moment(item.createdAt).format('YYYY-MM-DD-hh:mm:ss'),
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
        txHash: item.transactionId,
        network: getNetworkNameById(item.transactionNetworkId),
        source: 'giveth.io',
        giverName: item && item.user && item.user.name,
        giverEmail: item && item.user && item.user.email,
        projectLink: `https://giveth.io/project/${item.project.slug}`,

        isReferrerGivbackEligible: item.isReferrerGivbackEligible,
        referrerWallet: item.referrerWallet,

        numberOfStreamedDonations: item.numberOfStreamedDonations,
        parentRecurringDonationId: item?.recurringDonation?.id,
        parentRecurringDonationTxHash: item?.recurringDonation?.txHash
      }
    });

    const formattedDonationsToNotVerifiedProjects: FormattedDonation[] = donationsToNotVerifiedProjects.map(item => {
      const givbackFactor = item.givbackFactor || 0.5;
      return {
        amount: item.amount,
        anonymous: item.anonymous,
        currency: item.currency,
        createdAt: moment(item.createdAt).format('YYYY-MM-DD-hh:mm:ss'),
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
        txHash: item.transactionId,
        network: getNetworkNameById(item.transactionNetworkId),
        source: 'giveth.io',
        giverName: item && item.user && item.user.name,
        giverEmail: item && item.user && item.user.email,
        projectLink: `https://giveth.io/project/${item.project.slug}`,

        isReferrerGivbackEligible: item.isReferrerGivbackEligible,
        referrerWallet: item.referrerWallet,

        parentRecurringDonationId: item?.recurringDonation?.id,
        parentRecurringDonationTxHash: item?.recurringDonation?.txHash
      }
    });
    const eligibleDonations =  await filterDonationsWithPurpleList(formattedDonationsToVerifiedProjects)
    const notEligibleDonations = (
      await purpleListDonations(formattedDonationsToVerifiedProjects)
    ).concat(formattedDonationsToNotVerifiedProjects)
    const eligibleTxHashes = new Set(eligibleDonations.map(donation => donation.txHash));
    const commonDonations = notEligibleDonations.filter(donation => eligibleTxHashes.has(donation.txHash));


    console.log('donations length', {
      eligibleDonations: eligibleDonations.length,
      notEligibleDonations: notEligibleDonations.length,

      // It should be zero
      commonDonations: commonDonations.length
    })
    return eligible ? eligibleDonations : notEligibleDonations


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
    const fromDate = beginDate.split('/').join('').replace('-', ' ')
    const toDate = endDate.split('/').join('').replace('-', ' ')
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
      return {
        amount: item.amount,
        currency: item.currency,
        createdAt: moment(item.createdAt).format('YYYY-MM-DD-hh:mm:ss'),
        valueUsd: item.valueUsd,
        givbackFactor: item.givbackFactor,
        giverAddress: donationGiverAddress(item),
        txHash: item.transactionId,
        network: getNetworkNameById(item.transactionNetworkId),
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


