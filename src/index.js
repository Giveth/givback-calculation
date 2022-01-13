const dotenv = require('dotenv')
if (process.env.NODE_ENV !== 'develop') {
  // In develop env we use .env in docker-compose so we dont need dotenv package
  dotenv.config()
}

const {
  getDonationsReport: givethTraceDonations,
  getEligibleDonations: givethTraceEligibleDonations
} = require('./givethTraceService')

const {
  getDonationsReport: givethIoDonations,
  getEligibleDonations: givethIoEligibleDonations, getPurpleList
} = require('./givethIoService')

const express = require('express');
const _ = require('underscore');
const swaggerUi = require('swagger-ui-express');
const {parse} = require('json2csv');

const swaggerDocument = require('./swagger.json');
const {createSmartContractCallParams} = require("./utils");
const {
  getBlockNumberOfTxHash, getTimestampOfBlock, getEthGivPriceInMainnet,
  getEthGivPriceInXdai, getEthPriceTimeStamp
} = require("./priceService");


const configPurpleList = process.env.PURPLE_LIST ? process.env.PURPLE_LIST.split(',').map(address => address.toLowerCase()) : []


const app = express();
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get(`/calculate-givback`, async (req, res) => {
  try {
    console.log('start calculating')
    const {
      download, endDate, startDate,
      distributorAddress, nrGIVAddress, tokenDistroAddress,
      maxAddressesPerFunctionCall
    } = req.query;
    const givPrice = Number(req.query.givPrice)
    const givAvailable = Number(req.query.givAvailable)
    const givWorth = givAvailable * givPrice
    const givMaxFactor = Number(req.query.givMaxFactor)
    const [traceDonations, givethDonations] = await Promise.all([givethTraceDonations(startDate, endDate),
      givethIoDonations(startDate, endDate)
    ]);
    const purpleList = (await getPurpleList()).map(address => address.toLowerCase()).concat(configPurpleList)
    const uniquePurpleList = [...new Set(purpleList)];
    const traceDonationsAmount = traceDonations.reduce((previousValue, currentValue) => {
      return previousValue + currentValue.totalAmount
    }, 0);
    const givethioDonationsAmount = givethDonations.reduce((previousValue, currentValue) => {
      return previousValue + currentValue.totalAmount
    }, 0);
    const groupByGiverAddress = _.groupBy(traceDonations.concat(givethDonations), 'giverAddress')
    const result = _.map(groupByGiverAddress, (value, key) => {
      return {
        giverAddress: key.toLowerCase(),
        giverEmail: value[0].giverEmail,
        giverName: value[0].giverName,
        totalAmount: _.reduce(value, (total, o) => {
          return total + o.totalAmount;
        }, 0)
      };
    }).filter(item => {
      return !uniquePurpleList.includes(item.giverAddress)
    }).sort((a, b) => {
      return b.totalAmount - a.totalAmount
    });
    let raisedValueSum = 0;
    for (const donation of result) {
      raisedValueSum += donation.totalAmount;
    }
    const givFactor = Math.min(givWorth / raisedValueSum, givMaxFactor)
    const givDistributed = givFactor * (raisedValueSum / givPrice);
    const donationsWithShare = result.map(item => {
      const share = item.totalAmount / raisedValueSum;
      const givback = (item.totalAmount / givPrice) * givFactor;
      return {
        giverAddress: item.giverAddress,
        giverEmail: item.giverEmail,
        giverName: item.giverName,
        totalAmount: Number(item.totalAmount).toFixed(2),
        givback: Number(givback.toFixed(2)),
        givbackUsdValue: (givback * givPrice).toFixed(2),
        share: Number(share.toFixed(8)),
      }
    }).filter(item => {
      return item.share > 0
    })
    const smartContractCallParams = createSmartContractCallParams(
      {
        distributorAddress, nrGIVAddress, tokenDistroAddress,
        donationsWithShare: donationsWithShare.filter(givback => givback.givback > 0)
      },
      Number(maxAddressesPerFunctionCall) || 200
    );
    const response = {
      raisedValueSumExcludedPurpleList: Math.ceil(raisedValueSum),
      givDistributed: Math.ceil(givDistributed),
      traceDonationsAmount: Math.ceil(traceDonationsAmount),
      givethioDonationsAmount: Math.ceil(givethioDonationsAmount),
      givFactor: Number(givFactor.toFixed(4)),
      ...smartContractCallParams,
      givbacks: donationsWithShare,
      purpleList: uniquePurpleList,
    };
    if (download === 'yes') {
      const csv = parse(response.givbacks.map(item => {
        return {
          givDistributed,
          givFactor,
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
  } catch (e) {
    console.log("error happened", e)
    res.status(400).send({
      message: e.message
    })
  }
})


app.get(`/eligible-donations`, async (req, res) => {
  try {
    const {endDate, startDate, download} = req.query;
    const [traceDonations, givethIoDonations] = await Promise.all([
      givethTraceEligibleDonations(startDate, endDate),
      givethIoEligibleDonations(startDate, endDate)]
    );
    const purpleList = (await getPurpleList()).map(address => address.toLowerCase()).concat(configPurpleList)
    const uniquePurpleList = [...new Set(purpleList)];
    const donations =
      traceDonations.concat(givethIoDonations).filter(item => {
        return !uniquePurpleList.includes(item.giverAddress.toLowerCase())
      }).sort((a, b) => {
        return b.createdAt >= a.createdAt ? 1 : -1
      })

    if (download === 'yes') {
      const csv = parse(donations);
      const fileName = `eligible-donations${startDate}-${endDate}.csv`;
      res.setHeader('Content-disposition', "attachment; filename=" + fileName);
      res.setHeader('Content-type', 'application/json');
      res.send(csv)
    } else {
      res.send(donations)
    }
  } catch (e) {
    console.log("error happened", e)
    res.status(400).send({
      message: e.message
    })
  }
})

app.get(`/donations-leaderboard`, async (req, res) => {
  try {
    console.log('start calculating')
    const {total, endDate, startDate} = req.query;
    const numberOfLeaderBoard = Number(total) || 10
    const traceDonations = await givethTraceDonations(startDate, endDate);
    const givethDonations = await givethIoDonations(startDate, endDate);
    const traceDonationsAmount = traceDonations.reduce((previousValue, currentValue) => {
      return previousValue + currentValue.totalAmount
    }, 0);
    const givethioDonationsAmount = givethDonations.reduce((previousValue, currentValue) => {
      return previousValue + currentValue.totalAmount
    }, 0);
    const groupByGiverAddress = _.groupBy(traceDonations.concat(givethDonations), 'giverAddress')
    const result = _.map(groupByGiverAddress, function (value, key) {
      return {
        giverAddress: key.toLowerCase(),
        totalAmount: _.reduce(value, function (total, o) {
          return total + o.totalAmount;
        }, 0)
      };
    }).sort((a, b) => {
      return b.totalAmount - a.totalAmount
    });
    const response = {
      traceDonationsAmount: Math.ceil(traceDonationsAmount),
      givethioDonationsAmount: Math.ceil(givethioDonationsAmount),
      totalDonationsAmount: Math.ceil(givethioDonationsAmount) + Math.ceil(traceDonationsAmount),
      traceLeaderboard: traceDonations.slice(0, numberOfLeaderBoard),
      givethIoLeaderboard: givethDonations.slice(0, numberOfLeaderBoard),
      totalLeaderboard: result.slice(0, numberOfLeaderBoard)
    };

    res.send(response)
  } catch (e) {
    console.log("error happened", e)
    res.status(400).send({
      message: e.message
    })
  }
})

app.get('/givPrice', async (req, res) => {
  try {
    let {blockNumber, txHash, network = 'xdai'} = req.query;
    if (blockNumber && txHash) {
      throw new Error('You should fill just one of txHash, blockNumber')
    }
    blockNumber = txHash ? await getBlockNumberOfTxHash(txHash, network) : Number(blockNumber)
    const givPriceInEth = network === 'mainnet' ? await getEthGivPriceInMainnet(blockNumber) : await getEthGivPriceInXdai(blockNumber);
    const timestamp = blockNumber ? await getTimestampOfBlock(blockNumber, network) : new Date().getTime()
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
  } catch (e) {
    res.status(400).send({errorMessage: e.message})
  }
})


app.get('/purpleList', async (req, res) => {
  try {
    const purpleList = (await getPurpleList()).map(address => address.toLowerCase()).concat(configPurpleList)
    const uniquePurpleList = [...new Set(purpleList)]
    res.json({purpleList: uniquePurpleList})
  } catch (e) {
    res.status(400).send({errorMessage: e.message})
  }
})


app.listen(3000, () => {
  console.log('listening to port 3000')
})
