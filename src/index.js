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
    const {download, endDate, startDate} = req.query;
    const givPrice = Number(req.query.givPrice)
    const givAvailable = Number(req.query.givAvailable)
    const givWorth = givAvailable * givPrice
    const givMaxFactor = Number(req.query.givMaxFactor)
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
    let raisedValueSum = 0;
    for (const donation of result) {
      raisedValueSum += donation.totalAmount;
    }
    const givFactor = Math.min(givWorth/raisedValueSum, givMaxFactor)
    const givDistributed = givFactor * raisedValueSum;
    const donationsWithShare = result.map(item => {
      const share = item.totalAmount / raisedValueSum;
      const givback = item.totalAmount  * givFactor;
      return {
        giverAddress: item.giverAddress,
        totalAmount: Number(item.totalAmount.toFixed(2)),
        givback: Number(givback.toFixed(2)),
        share: Number(share.toFixed(8)),
      }
    }).filter(item => {
      return item.share > 0
    })
    const response = {
      raisedValueSum: Math.ceil(raisedValueSum),
      givDistributed: Math.ceil(givDistributed),
      traceDonationsAmount :Math.ceil(traceDonationsAmount),
      givethioDonationsAmount: Math.ceil(givethioDonationsAmount),
      givFactor : Number(givFactor.toFixed(4)),
      givbacks: donationsWithShare
    };
    if (download === 'yes') {
      const data = JSON.stringify(response, null,4);
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
app.listen(3000, () => {
  console.log('listening to port 3000')
})
