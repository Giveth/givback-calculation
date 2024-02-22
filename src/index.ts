import {DonationResponse, FormattedDonation, MinimalDonation} from "./types/general";
import {Request, Response} from "express";

const dotenv = require('dotenv')
if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging') {
  // In production and staging env we use .env in docker-compose so we dont need dotenv package
  dotenv.config()
}

const express = require('express');
const _ = require('underscore');
const swaggerUi = require('swagger-ui-express');
const {parse} = require('json2csv');

const swaggerDocument = require('./swagger.json');
import {
  convertMinimalDonationToDonationResponse,
  createSmartContractCallAddBatchParams,
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
  getVerifiedPurpleListDonations
} from './givethIoService'

import {getPurpleList} from './commonServices'
import {get_dumpers_list} from "./subgraphService";
import {getAssignHistory} from "./givFarm/givFarmService";

const nrGIVAddress = '0xA1514067E6fE7919FB239aF5259FfF120902b4f9'
const {version} = require('../package.json');

const app = express();

swaggerDocument.info.version = version
swaggerDocument.basePath = process.env.NODE_ENV === 'staging' ? '/staging' : '/'
const swaggerPrefix = process.env.NODE_ENV === 'staging' ? '/staging' : ''
// https://stackoverflow.com/a/58052537/4650625
app.use(`${swaggerPrefix}/api-docs`, swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get(`/calculate`,
  async (req: Request, res: Response) => {
    try {
      console.log('start calculating')
      const {
        download, endDate, startDate,
        maxAddressesPerFunctionCall,
        niceWhitelistTokens,
        niceProjectSlugs, nicePerDollar,
      } = req.query;
      const givAvailable = Number(req.query.givAvailable)
      const givPrice = Number(req.query.givPrice)
      const givWorth = givAvailable * givPrice

      const tokens = (niceWhitelistTokens as string).split(',')
      const slugs = (niceProjectSlugs as string).split(',')

      const givethDonationsForNice = await getDonationsReport(
        {
          beginDate: startDate as string,
          endDate: endDate as string,
          niceWhitelistTokens: tokens,
          niceProjectSlugs: slugs,
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
      const optimismDonations = await getDonationsReport({
        beginDate: startDate as string,
        endDate: endDate as string,
        applyChainvineReferral: true,
        chain: "optimism"
      });
      const otherChainDonations = await getDonationsReport({
        beginDate: startDate as string,
        endDate: endDate as string,
        applyChainvineReferral: true,
        chain: "all-other-chains"
      });

      const totalDonations = await getDonationsReport({
        beginDate: startDate as string,
        endDate: endDate as string,
        applyChainvineReferral: true,
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
      const groupByGiverAddressForOptimismDonations = _.groupBy(optimismDonations, 'giverAddress')
      const groupByGiverAddressForAllOtherChainsDonations = _.groupBy(otherChainDonations, 'giverAddress')


      const optimismMinimalDonations = getDonationsForSmartContractParams({
        maxGivbackFactorPercentage,
        groupByGiverAddress: groupByGiverAddressForOptimismDonations
      })

      const allOtherChainsMinimalDonations = getDonationsForSmartContractParams({
        maxGivbackFactorPercentage,
        groupByGiverAddress: groupByGiverAddressForAllOtherChainsDonations
      })

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

      const optimismDonationsWithShare = convertMinimalDonationToDonationResponse({
        minimalDonationsArray: optimismMinimalDonations,
        givPrice,
        raisedValueSum
      })


      const allOtherChainsDonationsWithShare = convertMinimalDonationToDonationResponse({
        minimalDonationsArray: allOtherChainsMinimalDonations,
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
      const optimismRelayerAddress = '0xf13e93af5e706ab3073e393e77bb2d7ce7bec01f'
      const gnosisRelayerAddress = '0xd0e81E3EE863318D0121501ff48C6C3e3Fd6cbc7'
      const response = {
        raisedValueSumExcludedPurpleList: Math.ceil(raisedValueSum),
        givDistributed,
        givethioDonationsAmount: Math.ceil(totalDonationsAmount),
        optimism: {
          smartContractParams: await createSmartContractCallAddBatchParams(
            {
              nrGIVAddress,
              donationsWithShare: optimismDonationsWithShare.filter(givback => givback.givback > 0),
              givRelayerAddress: optimismRelayerAddress,
              network:'optimism'
            },
            Number(maxAddressesPerFunctionCall) || 200
          ),
          givbacks: optimismDonationsWithShare
        },
        allOtherChains: {
          smartContractParams: await createSmartContractCallAddBatchParams(
            {
              nrGIVAddress,
              donationsWithShare: allOtherChainsDonationsWithShare.filter(givback => givback.givback > 0),
              givRelayerAddress: gnosisRelayerAddress,
              network:'gnosis'
            },
            Number(maxAddressesPerFunctionCall) || 200
          ),
          givbacks: allOtherChainsDonationsWithShare
        },
        niceTokens: niceDonationsWithShareFormatted,
        // niceRaisedValueSumExcludedPurpleList: Math.ceil(raisedValueForGivethioDonationsSum),
        // niceGivethioDonationsAmountForNice: Math.ceil(givethioDonationsAmountForNice),
        // niceShares: niceDonationsWithShare,
        purpleList: await getPurpleList(),
      };
      if (download === "all-other-chains") {
        const csv = parse(response.allOtherChains.givbacks.map((item: DonationResponse) => {
          return {
            givDistributed,
            givPrice,
            givbackUsdValue: givPrice * item.givback,
            ...item
          }
        }));
        const fileName = `givbackReport_allOtherChains_${startDate}-${endDate}.csv`;
        res.setHeader('Content-disposition', "attachment; filename=" + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(csv)
      } else if (download === "optimism") {
        const csv = parse(response.optimism.givbacks.map((item: DonationResponse) => {
          return {
            givDistributed,
            givPrice,
            givbackUsdValue: givPrice * item.givback,
            ...item
          }
        }));
        const fileName = `givbackReport_optimism_${startDate}-${endDate}.csv`;
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
      chain
    } = req.query;

    const givethIoDonations = await getEligibleDonations(
      {
        beginDate: startDate as string,
        endDate: endDate as string,
        eligible,
        justCountListed: justCountListed === 'yes',
        chain: chain as "all-other-chains" | "optimism"

      });
    const donations =
      givethIoDonations.sort((a: FormattedDonation, b: FormattedDonation) => {
        return b.createdAt >= a.createdAt ? 1 : -1
      })

    if (download === 'yes') {
      const csv = parse(donations);
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
      niceProjectSlugs, nicePerDollar
    } = req.query;

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

      });
    const donations =
      allDonations.sort((a: FormattedDonation, b: FormattedDonation) => {
        return b.createdAt >= a.createdAt ? 1 : -1
      }).map((donation: FormattedDonation) => {
        donation.niceTokens = (donation.valueUsd * Number(nicePerDollar)).toFixed(2)
        return donation
      })


    if (download === 'yes') {
      const csv = parse(donations);
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
      const csv = parse(donations);
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
    res.status(400).send({errorMessage: e.message})
  }
})


app.get('/purpleList', async (req: Request, res: Response) => {
  try {

    res.json({purpleList: await getPurpleList()})
  } catch (e: any) {
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
    res.status(400).send({errorMessage: e.message})
  }
})

app.get('/token_distro_assign_histories', async (req: Request, res: Response) => {
  try {
    const {tokenDistroAddress, uniPoolAddress, rpcUrl} = req.query;
    res.json(
      await getAssignHistory({
        tokenDistroAddress : tokenDistroAddress as string,
        uniPoolAddress: uniPoolAddress as string,
        rpcUrl: rpcUrl as string
      })
    )
  } catch (e: any) {
    console.log('error happened', e)
    res.status(400).send({errorMessage: e.message})
  }
})


app.listen(3000, () => {
  console.log('listening to port 3000')
})

