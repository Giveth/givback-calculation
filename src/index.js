const dotenv = require('dotenv')
if (process.env.NODE_ENV !== 'develop') {
  // In develop env we use .env in docker-compose so we dont need dotenv package
  dotenv.config()
}

const {getDonationsReport: givethTraceDonations} = require('./givethTraceService')
const {getDonationsReport: givethIoDonations, getPurpleList } = require('./givethIoService')
const express = require('express');
const _ = require('underscore');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const {createSmartContractCallParams} = require("./utils");

const app = express();
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get(`/calculate-givback`, async (req, res) => {
  try {
    console.log('start calculating')
    const {download, endDate, startDate,
      distributorAddress,nrGIVAddress, tokenDistroAddress} = req.query;
    const givPrice = Number(req.query.givPrice)
    const givAvailable = Number(req.query.givAvailable)
    const givWorth = givAvailable * givPrice
    const givMaxFactor = Number(req.query.givMaxFactor)
    const traceDonations = await givethTraceDonations(startDate, endDate);
    const givethDonations = await givethIoDonations(startDate, endDate);
    const purpleList = ( await getPurpleList() ).map(address => address.toLowerCase())
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
        totalAmount: _.reduce(value, (total, o) => {
          return total + o.totalAmount;
        }, 0)
      };
    }).filter(item => {
      return !purpleList.includes(item.giverAddress)
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
        totalAmount: Number((item.totalAmount / givPrice).toFixed(2)),
        givback: Number(givback.toFixed(2)),
        share: Number(share.toFixed(8)),
      }
    }).filter(item => {
      return item.share > 0
    })
    const response = {
      raisedValueSumExcludedPurpleList: Math.ceil(raisedValueSum),
      givDistributed: Math.ceil(givDistributed),
      traceDonationsAmount: Math.ceil(traceDonationsAmount),
      givethioDonationsAmount: Math.ceil(givethioDonationsAmount),
      givFactor: Number(givFactor.toFixed(4)),
      smartContractCallParams: createSmartContractCallParams(
        {
          distributorAddress, nrGIVAddress, tokenDistroAddress,
          donationsWithShare: donationsWithShare.filter(givback => givback.givback > 0)
        }),
      givbacks: donationsWithShare,
      purpleList,
    };
    if (download === 'yes') {
      const data = JSON.stringify(response, null, 4);
      const fileName = `givbackreport_${startDate}-${endDate}.json`;
      res.setHeader('Content-disposition', "attachment; filename=" + fileName);
      res.setHeader('Content-type', 'application/json');
      res.send(data)
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


app.listen(3000, () => {
  console.log('listening to port 3000')
})
