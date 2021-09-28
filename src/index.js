const {getDonationsReport: givethTraceDonations} = require('./givethTraceService')
const {getDonationsReport: givethIoDonations} = require('./givethIoService')
const express = require('express');
const _ = require('underscore');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');

const app = express();
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get(`/calculate-givback`, async (req, res) => {
  try {
    console.log('start calculating')
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const givPrice = Number(req.query.givPrice)
    const givAvailable = Number(req.query.givAvailable)
    const givMaxFactor = Number(req.query.givMaxFactor)
    const givWorth = givAvailable * givPrice
    const traceDonations = await givethTraceDonations(startDate, endDate);
    const givethDonations = await givethIoDonations(startDate, endDate);
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
    let raisedValueSum = 0;
    for (const donation of result) {
      raisedValueSum += donation.totalAmount;
    }
    let givDistributed;
    if (raisedValueSum > givWorth) {
      givDistributed = givAvailable
    } else {
      givDistributed = (givMaxFactor * raisedValueSum) / givPrice
    }
    const donationsWithShare = result.map(item => {
      const share = item.totalAmount / raisedValueSum;
      const givback = givDistributed * share;
      return {
        giverAddress: item.giverAddress,
        totalAmount: Number(item.totalAmount.toFixed(2)),
        givback: Number(givback.toFixed(2)),
        share: Number(share.toFixed(6)),
      }
    })
    res.send({
      raisedValueSum: Number(raisedValueSum.toFixed(2)),
      givDistributed: Number(givDistributed.toFixed(2)),
      givbacks: donationsWithShare
    })
  } catch (e) {
    console.log("error happened", e)
    res.status(400).send({
      message:e.message
    })
  }
})
app.listen(3000, () => {
  console.log('listening to port 3000')
})
