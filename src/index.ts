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
import {createSmartContractCallAddBatchParams} from "./utils";
import {
    getBlockNumberOfTxHash, getTimestampOfBlock, getEthGivPriceInMainnet,
    getEthGivPriceInXdai, getEthPriceTimeStamp
} from "./priceService";


import {
    getAllProjectsSortByRank,
    getDonationsReport as givethIoDonations,
    getEligibleDonations, getTopPowerRank,
    getVerifiedPurpleListDonations
} from './givethIoService'

import {donationValueAfterGivFactor, getPurpleList} from './commonServices'

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
                givRelayerAddress,
                niceWhitelistTokens,
                niceProjectSlugs, nicePerDollar,
                minGivFactor, maxGivFactor
            } = req.query;

            const topPowerRank = await getTopPowerRank()

            const givbackFactorParams = {
                minimumFactor: Number(minGivFactor),
                maximumFactor: Number(maxGivFactor),
                topPowerRank
            }
            const tokens = (niceWhitelistTokens as string).split(',')
            const slugs = (niceProjectSlugs as string).split(',')

            const givethDonationsForNice = await givethIoDonations(
                startDate as string, endDate as string, givbackFactorParams, tokens, slugs)

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

            const givPrice = Number(req.query.givPrice)
            const givethDonations = await givethIoDonations(startDate as string, endDate as string,
                givbackFactorParams);

            const givethioDonationsAmount = givethDonations.reduce((previousValue: number, currentValue: MinimalDonation) => {
                return previousValue + currentValue.totalDonationsUsdValue
            }, 0);
            const groupByGiverAddress = _.groupBy(givethDonations, 'giverAddress')
            const allDonations: MinimalDonation[] = _.map(groupByGiverAddress, (value: MinimalDonation[], key: string) => {
                const totalDonationsUsdValue = _.reduce(value, (total: number, o: MinimalDonation) => {
                    return total + o.totalDonationsUsdValue;
                }, 0)
                const totalDonationsUsdValueAfterGivFactor = _.reduce(value, (total: number, o: MinimalDonation) => {
                    return total + o.totalDonationsUsdValueAfterGivFactor;
                }, 0)
                return {
                    giverAddress: key.toLowerCase(),
                    giverEmail: value[0].giverEmail,
                    giverName: value[0].giverName,
                    totalDonationsUsdValue,
                    totalDonationsUsdValueAfterGivFactor,
                    averageGivbackFactor: (totalDonationsUsdValueAfterGivFactor / totalDonationsUsdValue).toFixed(7)
                };
            });
            const result = allDonations.sort((a, b) => {
                return b.totalDonationsUsdValueAfterGivFactor - a.totalDonationsUsdValueAfterGivFactor
            });
            let raisedValueSum = 0;
            for (const donation of result) {
                raisedValueSum += donation.totalDonationsUsdValue;
            }
            let raisedValueSumAfterGivFactor = 0;
            for (const donation of result) {
                raisedValueSumAfterGivFactor += donation.totalDonationsUsdValueAfterGivFactor;
            }
            // const givFactor = Math.min(givWorth / raisedValueSum, givMaxFactor)
            // const givDistributed = givFactor * (raisedValueSum / givPrice);
            const donationsWithShare: DonationResponse[] = result.map((item: MinimalDonation) => {
                const share = item.totalDonationsUsdValueAfterGivFactor / raisedValueSum;
                const givback = (item.totalDonationsUsdValueAfterGivFactor / givPrice)
                const niceShare = niceDonationsWithShare.find((niceShareItem: MinimalDonation) => niceShareItem.giverAddress === item.giverAddress)
                const totalDonationsUsdValueAfterGivFactor = Number(item.totalDonationsUsdValueAfterGivFactor.toFixed(7))
                const totalDonationsUsdValue = Number(item.totalDonationsUsdValue.toFixed(7))
                return {
                    giverAddress: item.giverAddress,
                    giverEmail: item.giverEmail,
                    giverName: item.giverName,
                    totalDonationsUsdValueAfterGivFactor,
                    totalDonationsUsdValue,
                    averageGivbackFactor: (totalDonationsUsdValueAfterGivFactor / totalDonationsUsdValue).toFixed(7),
                    givback: Number(givback.toFixed(7)),
                    givbackUsdValue: (givback * givPrice).toFixed(7),
                    share: Number(share.toFixed(7)),
                    niceEarned: niceShare ? niceShare.niceTokens : 0
                }
            }).filter(item => {
                return item.share > 0 || item.niceEarned > 0
            })

            for (const niceShareItem of niceDonationsWithShare) {
                // because purpleLists are not in donationsWithShare so we have to put a loop to include them
                if (donationsWithShare.find(donationShare => donationShare.giverAddress === niceShareItem.giverAddress)) {
                    continue;
                }
                donationsWithShare.push({
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
            const smartContractCallParams = await createSmartContractCallAddBatchParams(
                {
                    nrGIVAddress,
                    donationsWithShare: donationsWithShare.filter(givback => givback.givback > 0),
                    givRelayerAddress: givRelayerAddress as string
                },
                Number(maxAddressesPerFunctionCall) || 200
            );
            const givDistributed = Math.ceil(raisedValueSumAfterGivFactor / givPrice);

            const response = {
                raisedValueSumExcludedPurpleList: Math.ceil(raisedValueSum),
                givDistributed,
                givethioDonationsAmount: Math.ceil(givethioDonationsAmount),
                // givFactor: Number(givFactor.toFixed(4)),
                ...smartContractCallParams,
                givbacks: donationsWithShare,
                // niceRaisedValueSumExcludedPurpleList: Math.ceil(raisedValueForGivethioDonationsSum),
                // niceGivethioDonationsAmountForNice: Math.ceil(givethioDonationsAmountForNice),
                // niceShares: niceDonationsWithShare,
                topPowerRank,
                purpleList: await getPurpleList(),
            };
            if (download === 'yes') {
                const csv = parse(response.givbacks.map((item: DonationResponse) => {
                    return {
                        givDistributed,
                        givPrice,
                        givbackUsdValue: givPrice * item.givback,
                        ...item
                    }
                }));
                const fileName = `givbackreport_${startDate}-${endDate}.csv`;
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
            endDate, startDate, download, justCountListed, minGivFactor, maxGivFactor
        } = req.query;
        const topPowerRank = await getTopPowerRank()

        const givbackFactorParams = {
            minimumFactor: Number(minGivFactor),
            maximumFactor: Number(maxGivFactor),
            topPowerRank
        }
        const givethIoDonations = await getEligibleDonations(
            {
                beginDate: startDate as string,
                endDate: endDate as string,
                eligible,
                justCountListed: justCountListed === 'yes',
                givbackFactorParams
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
            niceProjectSlugs, nicePerDollar,
            minGivFactor, maxGivFactor
        } = req.query;

        const topPowerRank = await getTopPowerRank()

        const givbackFactorParams = {
            minimumFactor: Number(minGivFactor),
            maximumFactor: Number(maxGivFactor),
            topPowerRank
        }
        const tokens = (niceWhitelistTokens as string).split(',')
        const slugs = (niceProjectSlugs as string).split(',')
        const allDonations = await getEligibleDonations(
            {
                beginDate: startDate as string,
                niceWhitelistTokens: tokens,
                niceProjectSlugs: slugs,
                endDate: endDate as string,
                eligible: true,
                givbackFactorParams,
                justCountListed: justCountListed === 'yes'
            });
        const donations =
            allDonations.sort((a: FormattedDonation, b: FormattedDonation) => {
                return b.createdAt >= a.createdAt ? 1 : -1
            }).map((donation: FormattedDonation) => {
                donation.niceTokens = (Number(donation.valueUsd) * Number(nicePerDollar)).toFixed(2)
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


app.listen(3000, () => {
    console.log('listening to port 3000')
})

