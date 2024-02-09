import {FormattedDonation, GivbackFactorParams, GivethIoDonation, MinimalDonation, Project, GIVbacksRound} from "./types/general";
import {GIVETH_TOKEN_DISTRO_ADDRESS} from "./subgraphService";
import {ethers} from 'ethers'
import TokenDistroJSON from '../abi/TokenDistroV2.json'
require('dotenv').config()

const {gql, request} = require('graphql-request');
const moment = require('moment')
const _ = require('underscore')

import {
  donationValueAfterGivFactor,
  filterDonationsWithPurpleList,
  purpleListDonations
} from './commonServices'
import {
  calculateReferralRewardFromRemainingAmount,
  calculateReferralReward,
  getNetworkNameById,
  filterRawDonationsByChain
} from "./utils";

const givethiobaseurl = process.env.GIVETHIO_BASE_URL

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
    niceWhitelistTokens?: string[],
    niceProjectSlugs?: string[],
    eligible?: boolean,
    disablePurpleList?: boolean,
    justCountListed?: boolean,
    chain ?: "all-other-chains" |"optimism"

  }): Promise<FormattedDonation[]> => {
  try {
    const {
      beginDate,
      endDate,
      niceWhitelistTokens,
      niceProjectSlugs,
      disablePurpleList,
      justCountListed,
      chain
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
            isProjectVerified
            projectRank
            powerRound
            bottomRankInRound
            isReferrerGivbackEligible
            referrerWallet
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
            }
            fromWalletAddress
            status
          }
        }
    `;

    const result = await request(`${givethiobaseurl}/graphql`, query)
    const rawDonationsFilterByChain = filterRawDonationsByChain(result, chain)
    let donationsToVerifiedProjects: GivethIoDonation[] = rawDonationsFilterByChain
      .filter(
        (donation: GivethIoDonation) =>
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && donation.isProjectVerified
          && donation.status === 'verified'
      )

    let donationsToNotVerifiedProjects: GivethIoDonation[] = rawDonationsFilterByChain
      .filter(
        (donation: GivethIoDonation) =>
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && !donation.isProjectVerified
          && donation.status === 'verified'
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
        bottomRankInRound: item.bottomRankInRound,
        givbacksRound: item.powerRound,
        projectRank: item.projectRank,
        givbackFactor,
        valueUsdAfterGivbackFactor: donationValueAfterGivFactor({
          usdValue: item.valueUsd,
          givFactor: item.givbackFactor
        }),
        giverAddress: item.fromWalletAddress,
        txHash: item.transactionId,
        network: getNetworkNameById(item.transactionNetworkId),
        source: 'giveth.io',
        giverName: item && item.user && item.user.name,
        giverEmail: item && item.user && item.user.email,
        projectLink: `https://giveth.io/project/${item.project.slug}`,

        isReferrerGivbackEligible: item.isReferrerGivbackEligible,
        referrerWallet: item.referrerWallet
      }
    });

    const formattedDonationsToNotVerifiedProjects: FormattedDonation[] = donationsToNotVerifiedProjects.map(item => {
      const givbackFactor = item.givbackFactor || 0.5;
      return {
        amount: item.amount,
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
        giverAddress: item.fromWalletAddress,
        txHash: item.transactionId,
        network: getNetworkNameById(item.transactionNetworkId),
        source: 'giveth.io',
        giverName: item && item.user && item.user.name,
        giverEmail: item && item.user && item.user.email,
        projectLink: `https://giveth.io/project/${item.project.slug}`,

        isReferrerGivbackEligible: item.isReferrerGivbackEligible,
        referrerWallet: item.referrerWallet
      }
    });
    return eligible ?
      await filterDonationsWithPurpleList(formattedDonationsToVerifiedProjects, disablePurpleList) :
      (
        await purpleListDonations(formattedDonationsToVerifiedProjects, disablePurpleList)
      ).concat(formattedDonationsToNotVerifiedProjects)

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
            isProjectVerified
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
          && donation.isProjectVerified
          && donation.status === 'verified'
      )


    const formattedDonationsToVerifiedProjects = donationsToVerifiedProjects.map((item: GivethIoDonation) => {
      return {
        amount: item.amount,
        currency: item.currency,
        createdAt: moment(item.createdAt).format('YYYY-MM-DD-hh:mm:ss'),
        valueUsd: item.valueUsd,
        givbackFactor: item.givbackFactor,
        giverAddress: item.fromWalletAddress,
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

  niceWhitelistTokens?: string[],
  niceProjectSlugs?: string[],
  applyChainvineReferral?: boolean,
  chain ?: "all-other-chains" |"optimism"
}): Promise<MinimalDonation[]> => {
  const {
    beginDate,
    endDate,
    niceWhitelistTokens,
    niceProjectSlugs,
    applyChainvineReferral,
    chain
  } = params
  try {
    const response = await getEligibleDonations(
      {
        beginDate, endDate,
        niceWhitelistTokens,
        niceProjectSlugs,
        disablePurpleList: Boolean(niceWhitelistTokens),
        chain
      })


    let donations :FormattedDonation[] =[]
    if (!applyChainvineReferral){
      donations = response
    }else{
      for (const donation of response){
        if (donation.isReferrerGivbackEligible &&  donation.referrerWallet){
          // We split givback reward between giver and referrer
          donations.push(
            {
              ...donation,
              valueUsd : donation.valueUsd - calculateReferralReward(donation.valueUsd),
              referred: true
            },
            {
              ...donation,
              referrer :true,
              valueUsd : calculateReferralReward(donation.valueUsd),
              giverAddress: donation.referrerWallet,
              giverEmail: response.find(d => d.giverAddress ===donation.referrerWallet)?.giverEmail || '',
              giverName: response.find(d => d.giverAddress ===donation.referrerWallet)?.giverName || 'Referrer donor',
            }
          )
        }else{
          donations.push(donation)
        }
      }
    }
    console.log('**donations**', donations)
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
          return o.referrer ?  total + o.valueUsd:  total
        }, 0),
        totalReferralAddedUsdValueAfterGivFactor: _.reduce(value, function (total: number, o: FormattedDonation) {
          return o.referrer  ? total + donationValueAfterGivFactor({
            usdValue: o.valueUsd,
            givFactor: o.givbackFactor
          }) :  total;
        }, 0),

        totalReferralDeductedUsdValue: _.reduce(value, function (total: number, o: FormattedDonation) {
          return o.referred ? total + calculateReferralRewardFromRemainingAmount(o.valueUsd): total;
        }, 0),
        totalReferralDeductedUsdValueAfterGivFactor: _.reduce(value, function (total: number, o: FormattedDonation) {
          return  o.referred ? total + donationValueAfterGivFactor({
            usdValue: calculateReferralRewardFromRemainingAmount(o.valueUsd),
            givFactor: o.givbackFactor
          }): total;
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

export const getGIVbacksRound = async (round: number): Promise<GIVbacksRound> => {
  const twoWeeksInMilliseconds = 1209600000
  const ROUND_20_OFFSET = 345600000; //4 days in miliseconds - At round 20 we changed the rounds from Fridays to Tuesdays 

  let gnosisProvider = new ethers.providers.JsonRpcProvider(process.env.XDAI_NODE_HTTP_URL);
  const tokenDistroGC = new ethers.Contract(GIVETH_TOKEN_DISTRO_ADDRESS, TokenDistroJSON.abi, gnosisProvider);
  let startTime: any
  try {
    startTime = await tokenDistroGC.startTime();
  } catch(e) {
    console.log('Error in getting startTime', e)
    throw new Error('Error in getting startTime')
  }
  const startDate = new Date(startTime.toNumber() * 1000);
  const afterRound20 = startDate.getMilliseconds() + ROUND_20_OFFSET;

  const getRoundDates = (round: number): Date[] => {
    let roundStartDate: Date;
    let roundEndDate: Date;
    if (round < 1) {
      throw new Error('Invalid round number')
    
    }
    else if (round < 20) {
      roundStartDate = new Date(startDate.getTime() + (round -1) * twoWeeksInMilliseconds); 
      roundEndDate = new Date(startDate.getTime() + round * twoWeeksInMilliseconds - 1000);
    }
    else {
      roundStartDate = new Date(startDate.getTime() + (round-1) * twoWeeksInMilliseconds + afterRound20);
      roundEndDate = new Date(startDate.getTime() + round * twoWeeksInMilliseconds + afterRound20 - 1000);
    }
    return [roundStartDate, roundEndDate];
  }

  const [roundStartDate, roundEndDate] = getRoundDates(round);

  return {
    round,
    start: roundStartDate.toISOString(),
    end: roundEndDate.toISOString()
  }
}



