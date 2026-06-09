import {DonationResponse, FormattedDonation, MinimalDonation} from "./types/general";
import {Request, Response} from "express";
import {getCurrentGIVbacksRound, getGIVbacksRound} from "./givethIoService";
import {getBlockByTimestamp} from "./utils";

const dotenv = require('dotenv')
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging') {
  // In production and staging env we use .env in docker-compose so we dont need dotenv package
  dotenv.config()
}

const express = require('express');
const moment = require('moment')
const _ = require('underscore');
const swaggerUi = require('swagger-ui-express');
const {parse} = require('json2csv');

const swaggerDocument = require('./swagger.json');
import {
  convertMinimalDonationToDonationResponse,
  getDonationsForSmartContractParams
} from "./utils";
import {
  getBlockNumberOfTxHash, getTimestampOfBlock, getEthGivPriceInMainnet,
  getEthGivPriceInXdai, getEthPriceTimeStamp
} from "./priceService";


import {
  getAllProjectsSortByRank,
  getDonationsReport,
  getEligibleDonations,
  getGivbacksRoundDonations,
  getVerifiedPurpleListDonations
} from './givethIoService'

import {
  buildGivbacksRoundReport,
  parseRoundDonationsCsv
} from './givbacksRoundReportService'
import {
  getPurpleListExportRows,
  parsePurpleListCsv
} from './purpleListExportService'

import {getPurpleList} from './commonServices'
import {get_dumpers_list} from "./subgraphService";
import {get} from "https";
import {getAssignHistory} from "./givFarm/givFarmService";

const nrGIVAddress = '0xA1514067E6fE7919FB239aF5259FfF120902b4f9'
// Documented regular-donation minimum for GIVbacks eligibility (issue #323).
// Mirrors v6 Core's DEFAULT_MINIMUM_USD_AMOUNT.
const DEFAULT_MIN_ELIGIBLE_VALUE_USD = 4
const {version} = require('../package.json');

const app = express();

swaggerDocument.info.version = version

const donationCsvFields = [
  'amount',
  'currency',
  'createdAt',
  'valueUsd',
  'givbackFactor',
  'projectRank',
  'bottomRankInRound',
  'givbacksRound',
  'giverAddress',
  'txHash',
  'network',
  'source',
  'giverName',
  'giverEmail',
  'projectLink',
  'niceTokens',
  'info',
  'isReferrerGivbackEligible',
  'referrerWallet',
  'referrer',
  'referred',
  'anonymous',
  'parentRecurringDonationId',
  'parentRecurringDonationTxHash',
  'valueUsdAfterGivbackFactor',
]

const parseDonationCsv = (donations: FormattedDonation[]): string => {
  return parse(donations, {fields: donationCsvFields})
}

// swaggerDocument.basePath = process.env.NODE_ENV === 'staging' ? '/staging' : '/'
// const swaggerPrefix = process.env.NODE_ENV === 'staging' ? '/staging' : ''
// https://stackoverflow.com/a/58052537/4650625
// app.use(`${swaggerPrefix}/api-docs`, swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use(`/api-docs`, swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get(`/calculate`,
  async (req: Request, res: Response) => {
    try {
      console.log('start calculating')
      const {
        download, endDate, startDate,
        maxAddressesPerFunctionCall,
        niceWhitelistTokens,
        niceProjectSlugs, nicePerDollar,
        givethCommunityProjectSlug
      } = req.query;
      const givAvailable = Number(req.query.givAvailable)
      const givPrice = Number(req.query.givPrice)
      const minEligibleValueUsd = Number(req.query.minEligibleValueUsd)
      const givWorth = givAvailable * givPrice

      const tokens = (niceWhitelistTokens as string).split(',')
      const slugs = (niceProjectSlugs as string).split(',')

      const givethDonationsForNice = await getDonationsReport(
        {
          beginDate: startDate as string,
          endDate: endDate as string,
          niceWhitelistTokens: tokens,
          niceProjectSlugs: slugs,
          minEligibleValueUsd,
          givethCommunityProjectSlug: givethCommunityProjectSlug as string
        })

      const niceDonationsGroupByGiverAddress = _.groupBy(givethDonationsForNice, 'giverAddress')
      const allNiceDonations = _.map(niceDonationsGroupByGiverAddress, (value: MinimalDonation[], key: string) => {
        return {
          giverAddress: key.toLowerCase(),
          giverEmail: value[0].giverEmail,
          giverName: value[0].giverName,
          totalDonationsUsdValue: _.reduce(value, (total: number, o: MinimalDonation) => {
            return total + o.totalDonationsUsdValue;
          }, 0)
        };
      });
      const allNiceDonationsSorted = allNiceDonations.sort((a: MinimalDonation, b: MinimalDonation) => {
        return b.totalDonationsUsdValue - a.totalDonationsUsdValue
      });

      let raisedValueForGivethioDonationsSum = 0;
      for (const donation of allNiceDonationsSorted) {
        raisedValueForGivethioDonationsSum += donation.totalDonationsUsdValue;
      }
      const niceDonationsWithShare = allNiceDonationsSorted.map((item: MinimalDonation) => {
        const share = item.totalDonationsUsdValue / raisedValueForGivethioDonationsSum;
        return {
          giverAddress: item.giverAddress,
          giverEmail: item.giverEmail,
          giverName: item.giverName,
          totalDonationsUsdValue: Number(item.totalDonationsUsdValue).toFixed(2),
          niceTokens: (Number(item.totalDonationsUsdValue) * Number(nicePerDollar as string)).toFixed(2),
          share: Number(share.toFixed(8)),
        }
      }).filter((item: DonationResponse) => {
        return item.share > 0
      })

      // const givethDonations = await getDonationsReport({
      //     beginDate: startDate as string,
      //     endDate: endDate as string,
      //     applyChainvineReferral: true,
      //     chain: chain as "all-other-chains" |"optimism"
      // });
      //

      const totalDonations = await getDonationsReport({
        beginDate: startDate as string,
        endDate: endDate as string,
        applyChainvineReferral: true,
        givethCommunityProjectSlug: givethCommunityProjectSlug as string,
        minEligibleValueUsd
      });

      const totalDonationsAmount = totalDonations.reduce((previousValue: number, currentValue: MinimalDonation) => {
        return previousValue + currentValue.totalDonationsUsdValue
      }, 0);
      const totalDonationsAmountAfterGivbackFactor = totalDonations.reduce((previousValue: number, currentValue: MinimalDonation) => {
        return previousValue + currentValue.totalDonationsUsdValueAfterGivFactor
      }, 0);
      const maxGivbackFactorPercentage = Math.min(1,
        givWorth / totalDonationsAmountAfterGivbackFactor
      )


      const groupByGiverAddressForTotalDonations = _.groupBy(totalDonations, 'giverAddress')


      const totalMinimalDonations = getDonationsForSmartContractParams({
        maxGivbackFactorPercentage,
        groupByGiverAddress: groupByGiverAddressForTotalDonations
      })

      const totalMinimalDonationsSortedByUsdValue = totalMinimalDonations.sort((a, b) => {
        return b.totalDonationsUsdValueAfterGivFactor - a.totalDonationsUsdValueAfterGivFactor
      });
      let raisedValueSum = 0;
      for (const donation of totalMinimalDonationsSortedByUsdValue) {
        raisedValueSum += donation.totalDonationsUsdValue;
      }
      let raisedValueSumAfterGivFactor = 0;
      for (const donation of totalMinimalDonationsSortedByUsdValue) {
        raisedValueSumAfterGivFactor += donation.totalDonationsUsdValueAfterGivFactor;
      }


      // const givFactor = Math.min(givWorth / raisedValueSum, givMaxFactor)
      // const givDistributed = givFactor * (raisedValueSum / givPrice);


      const allChainsDonationsWithShare = convertMinimalDonationToDonationResponse({
        minimalDonationsArray: totalMinimalDonations,
        givPrice,
        raisedValueSum
      })

      const niceDonationsWithShareFormatted: DonationResponse[] = []
      for (const niceShareItem of niceDonationsWithShare) {
        niceDonationsWithShareFormatted.push({
          giverAddress: niceShareItem.giverAddress,
          giverEmail: niceShareItem.giverEmail,
          giverName: niceShareItem.giverName,
          totalDonationsUsdValue: niceShareItem.totalDonationsUsdValue,
          totalDonationsUsdValueAfterGivFactor: niceShareItem.totalDonationsUsdValueAfterGivFactor,
          givback: 0,
          share: 0,
          niceEarned: niceShareItem.niceTokens
        })
      }
      const givDistributed = Math.ceil(raisedValueSumAfterGivFactor / givPrice);

      // https://github.com/Giveth/givback-calculation/issues/35#issuecomment-1716106403
      // const optimismRelayerAddress = '0xf13e93af5e706ab3073e393e77bb2d7ce7bec01f'
      const response = {
        raisedValueSumExcludedPurpleList: Math.ceil(raisedValueSum),
        givDistributed,
        givethioDonationsAmount: Math.ceil(totalDonationsAmount),
        allChains: {
          // smartContractParams: await createSmartContractCallAddBatchParams(
          //   {
          //     nrGIVAddress,
          //     donationsWithShare: allChainsDonationsWithShare.filter(givback => givback.givback > 0),
          //     givRelayerAddress: optimismRelayerAddress,
          //     network: 'optimism'
          //   },
          //   Number(maxAddressesPerFunctionCall) || 200
          // ),
          smartContractParams:'No need for smartContractParams',
          givbacks: allChainsDonationsWithShare
        },
        niceTokens: niceDonationsWithShareFormatted,
        purpleList: await getPurpleList(),
      };
      if (download === "yes") {
        const csv = parse(response.allChains.givbacks.map((item: DonationResponse) => {
          return {
            givDistributed,
            givPrice,
            givbackUsdValue: givPrice * item.givback,
            ...item
          }
        }));
        const fileName = `givbackReport_allChains_${startDate}-${endDate}.csv`;
        res.setHeader('Content-disposition', "attachment; filename=" + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(csv)
      } else if (download === 'NICE') {
        const csv = parse(response.niceTokens);
        const fileName = `givbackReport_NICE_${startDate}-${endDate}.csv`;
        res.setHeader('Content-disposition', "attachment; filename=" + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(csv)
      } else {
        res.send(response)
      }
    } catch (e: any) {
      console.log("error happened", e)
      res.status(400).send({
        message: e.message
      })
    }
  })

const getEligibleAndNonEligibleDonations = async (req: Request, res: Response, eligible = true) => {
  try {
    const {
      endDate, startDate, download, justCountListed,
    } = req.query;
    const minEligibleValueUsd = Number(req.query.minEligibleValueUsd)
    const givethCommunityProjectSlug = req.query.givethCommunityProjectSlug

    const givethIoDonations = await getEligibleDonations(
      {
        beginDate: startDate as string,
        endDate: endDate as string,
        eligible,
        justCountListed: justCountListed === 'yes',
        givethCommunityProjectSlug: givethCommunityProjectSlug as string,
        minEligibleValueUsd
      });
    const donations =
      givethIoDonations.sort((a: FormattedDonation, b: FormattedDonation) => {
        return b.createdAt >= a.createdAt ? 1 : -1
      })

    if (download === 'yes') {
      const csv = parseDonationCsv(donations);
      const fileName = `${eligible ? 'eligible-donations' : 'not-eligible-donations'}-${startDate}-${endDate}.csv`;
      res.setHeader('Content-disposition', "attachment; filename=" + fileName);
      res.setHeader('Content-type', 'application/json');
      res.send(csv)
    } else {
      res.send(donations)
    }
  } catch (e: any) {
    console.log("error happened", e)
    res.status(400).send({
      message: e.message
    })
  }
}

const getEligibleDonationsForNiceToken = async (req: Request, res: Response, eligible = true) => {
  try {
    const {
      endDate, startDate, download, justCountListed, niceWhitelistTokens,
      niceProjectSlugs, nicePerDollar, givethCommunityProjectSlug
    } = req.query;
    const minEligibleValueUsd = Number(req.query.minEligibleValueUsd)

    const tokens = (niceWhitelistTokens as string).split(',')
    const slugs = (niceProjectSlugs as string).split(',')
    const allDonations = await getEligibleDonations(
      {
        beginDate: startDate as string,
        niceWhitelistTokens: tokens,
        niceProjectSlugs: slugs,
        endDate: endDate as string,
        eligible: true,
        justCountListed: justCountListed === 'yes',
        minEligibleValueUsd,
        givethCommunityProjectSlug: givethCommunityProjectSlug as string

      });
    const donations =
      allDonations.sort((a: FormattedDonation, b: FormattedDonation) => {
        return b.createdAt >= a.createdAt ? 1 : -1
      }).map((donation: FormattedDonation) => {
        donation.niceTokens = (donation.valueUsd * Number(nicePerDollar)).toFixed(2)
        return donation
      })


    if (download === 'yes') {
      const csv = parseDonationCsv(donations);
      const fileName = `${eligible ? 'eligible-donations-for-nice-tokens' : 'not-eligible-donations'}-${startDate}-${endDate}.csv`;
      res.setHeader('Content-disposition', "attachment; filename=" + fileName);
      res.setHeader('Content-type', 'application/json');
      res.send(csv)
    } else {
      res.send(donations)
    }
  } catch (e: any) {
    console.log("error happened", e)
    res.status(400).send({
      message: e.message
    })
  }
}

app.get(`/eligible-donations`, async (req: Request, res: Response) => {
  await getEligibleAndNonEligibleDonations(req, res, true)
})
app.get(`/getAllProjectsSortByRank`, async (req: Request, res: Response) => {
  const result = await getAllProjectsSortByRank()
  res.send(result)
})


app.get(`/eligible-donations-for-nice-token`, async (req: Request, res: Response) => {
  await getEligibleDonationsForNiceToken(req, res)
})

app.get(`/not-eligible-donations`, async (req: Request, res: Response) => {
  await getEligibleAndNonEligibleDonations(req, res, false)
})


app.get(`/purpleList-donations-to-verifiedProjects`, async (req: Request, res: Response) => {
  try {
    const {endDate, startDate, download} = req.query;
    const givethIoDonations = await getVerifiedPurpleListDonations(startDate as string, endDate as string);

    const donations =
      givethIoDonations.sort((a: FormattedDonation, b: FormattedDonation) => {
        return b.createdAt >= a.createdAt ? 1 : -1
      })

    if (download === 'yes') {
      const csv = parseDonationCsv(donations);
      const fileName = `purpleList-donations-to-verifiedProjectz-${startDate}-${endDate}.csv`;
      res.setHeader('Content-disposition', "attachment; filename=" + fileName);
      res.setHeader('Content-type', 'application/json');
      res.send(csv)
    } else {
      res.send(donations)
    }
  } catch (e: any) {
    console.log("error happened", e)
    res.status(400).send({
      message: e.message
    })
  }
})


// app.get(`/donations-leaderboard`, async (req: Request, res: Response) => {
//     try {
//         console.log('start calculating')
//         const {total, endDate, startDate} = req.query;
//         const numberOfLeaderBoard = Number(total) || 10
//         const givethDonations = await givethIoDonations(startDate as string, endDate as string);
//         const givethioDonationsAmount = givethDonations.reduce((previousValue: number, currentValue: MinimalDonation) => {
//             return previousValue + currentValue.totalDonationsUsdValue
//         }, 0);
//         const groupByGiverAddress = _.groupBy(givethDonations, 'giverAddress')
//         const result = _.map(groupByGiverAddress, function (value: string, key: string) {
//             return {
//                 giverAddress: key.toLowerCase(),
//                 totalDonationsUsdValue: _.reduce(value, function (total: number, o: MinimalDonation) {
//                     return total + o.totalDonationsUsdValue;
//                 }, 0)
//             };
//         }).sort((a: MinimalDonation, b: MinimalDonation) => {
//             return b.totalDonationsUsdValue - a.totalDonationsUsdValue
//         });
//         const response = {
//             givethioDonationsAmount: Math.ceil(givethioDonationsAmount),
//             givethIoLeaderboard: givethDonations.slice(0, numberOfLeaderBoard),
//             totalLeaderboard: result.slice(0, numberOfLeaderBoard)
//         };
//
//         res.send(response)
//     } catch (e : any) {
//         console.log("error happened", e)
//         res.status(400).send({
//             message: e.message
//         })
//     }
// })

app.get('/givPrice', async (req: Request, res: Response) => {
  try {
    let {blockNumber, txHash, network = 'xdai'} = req.query;
    let realBlockNumber = Number(blockNumber)
    if (blockNumber && txHash) {
      throw new Error('You should fill just one of txHash, blockNumber')
    }
    try {
      realBlockNumber = txHash ? await getBlockNumberOfTxHash(txHash as string, network as string) : Number(blockNumber)
    } catch (e) {
      console.log('Error getting blockNumber of txHash', e)
    }
    const givPriceInEth = network === 'mainnet' ? await getEthGivPriceInMainnet(realBlockNumber) : await getEthGivPriceInXdai(realBlockNumber);
    const timestamp = blockNumber ? await getTimestampOfBlock(realBlockNumber, network as string) : new Date().getTime()
    const ethPriceInUsd = await getEthPriceTimeStamp(timestamp);
    const givPriceInUsd = givPriceInEth * ethPriceInUsd

    console.log('prices', {
      givPriceInEth,
      ethPriceInUsd,
      givPriceInUsd
    })
    res.send({
      givPriceInEth,
      ethPriceInUsd,
      givPriceInUsd
    })
  } catch (e: any) {
    console.log('/givPrice error', {
      error: e,
      req,
    })
    res.status(400).send({errorMessage: e.message})
  }
})


app.get('/purpleList', async (req: Request, res: Response) => {
  try {

    res.json({purpleList: await getPurpleList()})
  } catch (e: any) {
    console.log('/purpleList error', {
      error: e,
      req,
    })
    res.status(400).send({errorMessage: e.message})
  }
})
app.get('/givDumpers', async (req: Request, res: Response) => {
  try {
    res.json(
      await get_dumpers_list({
        minTotalClaimed: req.query.minTotalClaimed as string,
        minGivHold: req.query.minGivHold as string,

      })
    )
  } catch (e: any) {
    console.log('/givDumpers error', {
      error: e,
      req,
    })
    res.status(400).send({errorMessage: e.message})
  }
})

app.get('/token_distro_assign_histories', async (req: Request, res: Response) => {
  try {
    const {tokenDistroAddress, uniPoolAddress, rpcUrl} = req.query;
    res.json(
      await getAssignHistory({
        tokenDistroAddress: tokenDistroAddress as string,
        uniPoolAddress: uniPoolAddress as string,
        rpcUrl: rpcUrl as string
      })
    )
  } catch (e: any) {
    console.log('/token_distro_assign_histories error', {
      error: e,
      req,
    })
    res.status(400).send({errorMessage: e.message})
  }
})


app.get(`/calculate-updated`,
  async (req: Request, res: Response) => {
    try {
      console.log('start calculating')
      const {
        download, roundNumber,
        maxAddressesPerFunctionCall,
        niceWhitelistTokens,
        niceProjectSlugs, nicePerDollar,
        givethCommunityProjectSlug,
      } = req.query;


      const givAvailable = Number(req.query.givAvailable)
      const minEligibleValueUsd = Number(req.query.minEligibleValueUsd)
      const {start, end} = await getGIVbacksRound(Number(roundNumber))
      const endDate = moment(end, 'YYYY/MM/DD-HH:mm:ss')
      const endDateTimestamp = endDate.unix()
      const priceBlock = await getBlockByTimestamp(endDateTimestamp, 1)
      console.log("priceBlock", priceBlock);
      const givPriceInETH = await getEthGivPriceInMainnet(priceBlock)
      const ethPrice = await getEthPriceTimeStamp(endDateTimestamp)
      console.log("/calculate-updated prices", {
        ethPrice,
        givPriceInETH,
        priceBlock,
        endDateTimestamp
      });
      const givPrice = givPriceInETH * ethPrice
      const givWorth = givAvailable * givPrice


      const tokens = (niceWhitelistTokens as string).split(',')
      const slugs = (niceProjectSlugs as string).split(',')
      console.log('beginDate', start)
      console.log('endDate', end)
      const givethDonationsForNice = await getDonationsReport(
        {
          beginDate: start,
          endDate: end,
          niceWhitelistTokens: tokens,
          niceProjectSlugs: slugs,
          givethCommunityProjectSlug: givethCommunityProjectSlug as string,
          minEligibleValueUsd
        })

      const niceDonationsGroupByGiverAddress = _.groupBy(givethDonationsForNice, 'giverAddress')
      const allNiceDonations = _.map(niceDonationsGroupByGiverAddress, (value: MinimalDonation[], key: string) => {
        return {
          giverAddress: key.toLowerCase(),
          giverEmail: value[0].giverEmail,
          giverName: value[0].giverName,
          totalDonationsUsdValue: _.reduce(value, (total: number, o: MinimalDonation) => {
            return total + o.totalDonationsUsdValue;
          }, 0)
        };
      });
      const allNiceDonationsSorted = allNiceDonations.sort((a: MinimalDonation, b: MinimalDonation) => {
        return b.totalDonationsUsdValue - a.totalDonationsUsdValue
      });

      let raisedValueForGivethioDonationsSum = 0;
      for (const donation of allNiceDonationsSorted) {
        raisedValueForGivethioDonationsSum += donation.totalDonationsUsdValue;
      }
      const niceDonationsWithShare = allNiceDonationsSorted.map((item: MinimalDonation) => {
        const share = item.totalDonationsUsdValue / raisedValueForGivethioDonationsSum;
        return {
          giverAddress: item.giverAddress,
          giverEmail: item.giverEmail,
          giverName: item.giverName,
          totalDonationsUsdValue: Number(item.totalDonationsUsdValue).toFixed(2),
          niceTokens: (Number(item.totalDonationsUsdValue) * Number(nicePerDollar as string)).toFixed(2),
          share: Number(share.toFixed(8)),
        }
      }).filter((item: DonationResponse) => {
        return item.share > 0
      })
      const otherChainDonations = await getDonationsReport({
        beginDate: start,
        endDate: end,
        applyChainvineReferral: true,
        givethCommunityProjectSlug: givethCommunityProjectSlug as string,
        minEligibleValueUsd
      });


      console.log('***new webservice donations*** new', {
        otherChainDonations: otherChainDonations.length,
        start,
        end
      })


      const totalDonations = await getDonationsReport({
        beginDate: start,
        endDate: end,
        applyChainvineReferral: true,
        givethCommunityProjectSlug: givethCommunityProjectSlug as string,
        minEligibleValueUsd
      });

      const totalDonationsAmount = totalDonations.reduce((previousValue: number, currentValue: MinimalDonation) => {
        return previousValue + currentValue.totalDonationsUsdValue
      }, 0);
      const totalDonationsAmountAfterGivbackFactor = totalDonations.reduce((previousValue: number, currentValue: MinimalDonation) => {
        return previousValue + currentValue.totalDonationsUsdValueAfterGivFactor
      }, 0);
      const maxGivbackFactorPercentage = Math.min(1,
        givWorth / totalDonationsAmountAfterGivbackFactor
      )
      console.log('***new webservice donations*** new', {
        totalDonationsAmount,
        totalDonationsAmountAfterGivbackFactor,
        maxGivbackFactorPercentage,
        givWorth
        , givAvailable,
        givPrice
      })


      const groupByGiverAddressForTotalDonations = _.groupBy(totalDonations, 'giverAddress')



      const totalMinimalDonations = getDonationsForSmartContractParams({
        maxGivbackFactorPercentage,
        groupByGiverAddress: groupByGiverAddressForTotalDonations
      })

      const totalMinimalDonationsSortedByUsdValue = totalMinimalDonations.sort((a, b) => {
        return b.totalDonationsUsdValueAfterGivFactor - a.totalDonationsUsdValueAfterGivFactor
      });
      let raisedValueSum = 0;
      for (const donation of totalMinimalDonationsSortedByUsdValue) {
        raisedValueSum += donation.totalDonationsUsdValue;
      }
      let raisedValueSumAfterGivFactor = 0;
      for (const donation of totalMinimalDonationsSortedByUsdValue) {
        raisedValueSumAfterGivFactor += donation.totalDonationsUsdValueAfterGivFactor;
      }



      const totalDonationsWithShare = convertMinimalDonationToDonationResponse({
        minimalDonationsArray: totalMinimalDonations,
        givPrice,
        raisedValueSum
      })


      console.log('**totalDonationsWithShare**', totalDonationsWithShare.length)

      const niceDonationsWithShareFormatted: DonationResponse[] = []
      for (const niceShareItem of niceDonationsWithShare) {
        niceDonationsWithShareFormatted.push({
          giverAddress: niceShareItem.giverAddress,
          giverEmail: niceShareItem.giverEmail,
          giverName: niceShareItem.giverName,
          totalDonationsUsdValue: niceShareItem.totalDonationsUsdValue,
          totalDonationsUsdValueAfterGivFactor: niceShareItem.totalDonationsUsdValueAfterGivFactor,
          givback: 0,
          share: 0,
          niceEarned: niceShareItem.niceTokens
        })
      }
      const givDistributed = Math.ceil(raisedValueSumAfterGivFactor / givPrice);
      const optimismRelayerAddress = '0xf13e93af5e706ab3073e393e77bb2d7ce7bec01f'

      const response = {
        start,
        end,
        raisedValueSumExcludedPurpleList: Math.ceil(raisedValueSum),
        givDistributed,
        givethioDonationsAmount: Math.ceil(totalDonationsAmount),
        allChains: {
          // smartContractParams: await createSmartContractCallAddBatchParams(
          //   {
          //     nrGIVAddress,
          //     donationsWithShare: totalDonationsWithShare.filter(givback => givback.givback > 0),
          //     givRelayerAddress: optimismRelayerAddress,
          //     network: 'optimism'
          //   },
          //   Number(maxAddressesPerFunctionCall) || 200
          // ),
          smartContractParams:'No need for smartContractParams',
          givbacks: totalDonationsWithShare
        },
        niceTokens: niceDonationsWithShareFormatted,
        // niceRaisedValueSumExcludedPurpleList: Math.ceil(raisedValueForGivethioDonationsSum),
        // niceGivethioDonationsAmountForNice: Math.ceil(givethioDonationsAmountForNice),
        // niceShares: niceDonationsWithShare,
        purpleList: await getPurpleList(),
      };
      if (download === "yes") {
        const csv = parse(response.allChains.givbacks.map((item: DonationResponse) => {
          return {
            givDistributed,
            givPrice,
            givbackUsdValue: givPrice * item.givback,
            ...item
          }
        }));
        const fileName = `givbackReport_allChains_${start}-${end}.csv`;
        res.setHeader('Content-disposition', "attachment; filename=" + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(csv)
      }  else if (download === 'NICE') {
        const csv = parse(response.niceTokens);
        const fileName = `givbackReport_NICE_${start}-${end}.csv`;
        res.setHeader('Content-disposition', "attachment; filename=" + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(csv)
      } else {
        res.send(response)
      }
    } catch (e: any) {
      console.log('/calculate-updated error', {
        error: e,
        req,
      })
      res.status(400).send({
        message: e.message
      })
    }
  })

// Issue #323: GIVbacks Round Donation Export + Prize Pool Calculator.
// Inputs: startDate / endDate (UTC, format YYYY/MM/DD-HH:mm:ss), maxPrizePool
// (GIV). Optional: givPrice (else computed at round end), minEligibleValueUsd,
// givethCommunityProjectSlug, includeAllDonations=yes (eligible + ineligible),
// download=yes (CSV). Returns the per-donation export + prize-pool summary.
app.get(`/givbacks-round-report`, async (req: Request, res: Response) => {
  try {
    const {
      startDate, endDate, download, includeAllDonations,
      givethCommunityProjectSlug
    } = req.query;

    if (!startDate || !endDate) {
      throw new Error('startDate and endDate are required')
    }

    const maxPrizePool = Number(req.query.maxPrizePool)
    if (!Number.isFinite(maxPrizePool) || maxPrizePool <= 0) {
      throw new Error('maxPrizePool must be a positive number')
    }

    // Regular-donation minimum USD threshold (issue #323). Defaults to the
    // documented $4 when the caller omits it — previously defaulted to 0, which
    // made every donation eligible and was also forwarded to v6 Core, overriding
    // its own $4 default (0 ?? 4 === 0). An explicit value (incl. 0) is honored.
    const minEligibleValueUsd =
      req.query.minEligibleValueUsd !== undefined &&
      Number.isFinite(Number(req.query.minEligibleValueUsd))
        ? Number(req.query.minEligibleValueUsd)
        : DEFAULT_MIN_ELIGIBLE_VALUE_USD
    const includeIneligible = includeAllDonations === 'yes'

    // Strict UTC parsing so the round window and price-block lookup are
    // deterministic regardless of server timezone (issue #323).
    const dateFormat = 'YYYY/MM/DD-HH:mm:ss'
    const startMoment = moment.utc(startDate as string, dateFormat, true)
    const endMoment = moment.utc(endDate as string, dateFormat, true)
    if (!startMoment.isValid() || !endMoment.isValid()) {
      throw new Error(`startDate and endDate must be UTC ${dateFormat}`)
    }

    // GIV price at the end of the round (issue #323). An explicit override may be
    // passed for reproducing historical numbers without on-chain lookups.
    let givPrice = Number(req.query.givPrice)
    if (!Number.isFinite(givPrice) || givPrice <= 0) {
      try {
        const endDateTimestamp = endMoment.unix()
        const priceBlock = await getBlockByTimestamp(endDateTimestamp, 1)
        // getBlockByTimestamp swallows errors and returns 0. A 0 block is
        // falsy, so getEthGivPriceInMainnet(0) would silently query the
        // CURRENT pool instead of the round-end block — producing a plausible
        // but wrong price that escapes the givPrice<=0 guard below and would
        // scale the entire round's GIVbacks distribution. Fail loudly instead.
        if (!priceBlock || priceBlock <= 0) {
          throw new Error(
            'Could not resolve a mainnet block for the round-end timestamp',
          )
        }
        const givPriceInETH = await getEthGivPriceInMainnet(priceBlock)
        const ethPrice = await getEthPriceTimeStamp(endDateTimestamp)
        givPrice = givPriceInETH * ethPrice
        console.log('/givbacks-round-report computed GIV price', {
          endDateTimestamp, priceBlock, givPriceInETH, ethPrice, givPrice
        })
      } catch (priceError: any) {
        // Auto price computation hits external services (findblock, the GIV
        // subgraph, and a CryptoCompare ETH/USD lookup). When one of those
        // fails (e.g. CryptoCompare 401 without an API key) the raw error is
        // opaque ("Request failed with status code 401"). Surface an
        // actionable message and the documented override instead.
        console.log('/givbacks-round-report price computation failed', {
          error: priceError?.message ?? priceError,
        })
        throw new Error(
          `Could not auto-compute the round-end GIV price (${priceError?.message ?? priceError}). ` +
            'Pass an explicit &givPrice=<USD per GIV> to override.',
        )
      }
      if (!Number.isFinite(givPrice) || givPrice <= 0) {
        throw new Error(
          'Auto-computed GIV price was invalid. Pass an explicit &givPrice=<USD per GIV> to override.',
        )
      }
    }

    const donations = await getGivbacksRoundDonations(
      {
        beginDate: startDate as string,
        endDate: endDate as string,
        minEligibleValueUsd,
        givethCommunityProjectSlug: givethCommunityProjectSlug as string,
      },
      includeIneligible,
    )

    const report = buildGivbacksRoundReport({
      donations,
      givPrice,
      maxPrizePool,
      roundStartTime: startDate as string,
      roundEndTime: endDate as string,
    })

    if (download === 'yes') {
      const csv = parseRoundDonationsCsv(report.donations)
      const scope = includeIneligible ? 'all' : 'eligible'
      const safeStart = (startDate as string).replace(/[/:]/g, '-')
      const safeEnd = (endDate as string).replace(/[/:]/g, '-')
      const fileName = `givbacks-round-donations-${scope}-${safeStart}-${safeEnd}.csv`
      res.setHeader('Content-disposition', 'attachment; filename=' + fileName)
      res.setHeader('Content-type', 'text/csv')
      res.send(csv)
    } else {
      res.send({
        ...report.summary,
        includeAllDonations: includeIneligible,
        totalDonationsInExport: report.donations.length,
        donations: report.donations,
      })
    }
  } catch (e: any) {
    console.log('/givbacks-round-report error', { error: e })
    res.status(400).send({ message: e.message })
  }
})

// Issue #323: export the current GIVbacks purple list (addresses excluded from
// receiving GIVbacks) separately from the donation export.
app.get(`/givbacks-purple-list`, async (req: Request, res: Response) => {
  try {
    const { download } = req.query;
    const rows = await getPurpleListExportRows()

    if (download === 'yes') {
      const csv = parsePurpleListCsv(rows)
      const safeTimestamp = new Date().toISOString().replace(/[/:]/g, '-')
      const fileName = `givbacks-purple-list-${safeTimestamp}.csv`
      res.setHeader('Content-disposition', 'attachment; filename=' + fileName)
      res.setHeader('Content-type', 'text/csv')
      res.send(csv)
    } else {
      res.send({ totalAddresses: rows.length, purpleList: rows })
    }
  } catch (e: any) {
    console.log('/givbacks-purple-list error', { error: e })
    res.status(400).send({ message: e.message })
  }
})

app.get(`/current-round`, async (req: Request, res: Response) => {
    try {
      const result = await getCurrentGIVbacksRound()
      res.send(result)
    } catch (e: any) {
      console.log('/current-round error', {
        error: e,
        req,
      })
      res.status(400).send({errorMessage: e.message})
    }
  }
)


app.listen(3000, () => {
  console.log('listening to port 3000')
})
