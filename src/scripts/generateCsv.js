const {getDonationsReport: givethTraceDonations} = require("../givethTraceService");
const {getDonationsReport: givethIoDonations} = require("../givethIoService");
const _ = require("underscore");
const {createSmartContractCallParams} = require("../utils");
const {getPurpleList} = require("../commonServices");
const {parse} = require("json2csv");
const {writeFileSync} = require('fs')
const path = require("path");

const {sendDiscordMessage} = require("../discord");
const generateEligibleDonations = async ({
                                           endDate, startDate,
                                           distributorAddress, nrGIVAddress, tokenDistroAddress,
                                           maxAddressesPerFunctionCall,
                                           givAvailable, givMaxFactor
                                         }) => {
  try {
    console.log('start calculating')
    // const givPrice = 1
    const [traceDonations, givethDonations] = await Promise.all([givethTraceDonations(startDate, endDate),
      givethIoDonations(startDate, endDate)
    ]);

    const traceDonationsAmount = traceDonations.reduce((previousValue, currentValue) => {
      return previousValue + currentValue.totalDonationsUsdValue
    }, 0);
    const givethioDonationsAmount = givethDonations.reduce((previousValue, currentValue) => {
      return previousValue + currentValue.totalDonationsUsdValue
    }, 0);
    const groupByGiverAddress = _.groupBy(traceDonations.concat(givethDonations), 'giverAddress')
    const allDonations = _.map(groupByGiverAddress, (value, key) => {
      return {
        giverAddress: key.toLowerCase(),
        giverEmail: value[0].giverEmail,
        giverName: value[0].giverName,
        givPrice: value[0].givPrice,
        totalDonationsUsdValue: _.reduce(value, (total, o) => {
          return total + o.totalDonationsUsdValue;
        }, 0)
      };
    });
    const result = allDonations.sort((a, b) => {
      return b.totalDonationsUsdValue - a.totalDonationsUsdValue
    });
    let raisedValueSum = 0;
    let raisedGivValueSum = 0;
    for (const donation of result) {
      raisedValueSum += donation.totalDonationsUsdValue;
      raisedGivValueSum += donation.totalDonationsUsdValue / donation.givPrice
    }

    const givFactor = Math.min(givAvailable / raisedGivValueSum, givMaxFactor)
    const givDistributed = givFactor * raisedGivValueSum
    const donationsWithShare = result.map(item => {
      const share = (item.totalDonationsUsdValue / item.givPrice) / raisedGivValueSum;
      console.log('calculate share ', {
        totalDonationsUsdValue: item.totalDonationsUsdValue, givPrice: item.givPrice, raisedGivValueSum
      })
      const givback = (item.totalDonationsUsdValue / item.givPrice) * givFactor;
      return {
        giverAddress: item.giverAddress,
        giverEmail: item.giverEmail,
        giverName: item.giverName,
        totalDonationsUsdValue: Number(item.totalDonationsUsdValue).toFixed(2),
        givback: Number(givback.toFixed(2)),
        givbackUsdValue: (givback * item.givPrice).toFixed(2),
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
      purpleList: await getPurpleList(),
    };
    console.log('responses.givbacks', response.givbacks)
    const givbackCsv = parse(response.givbacks.map(item => {
      return {
        givDistributed,
        givFactor,
        givPrice: item.givPrice,
        givbackUsdValue: item.givPrice * item.givback,
        ...item
      }
    }));
    console.log('Write file ....... ', __dirname)
    const givbackCsvFilePath = path.resolve(`${__dirname}/../../files/givbacks-${startDate.split('/').join('_').split(':').join('_')}-to-${endDate.split('/').join('_').split(':').join('_')}.csv`)
    const givbackJsonFilePath = path.resolve(`${__dirname}/../../files/givbacksJson-${startDate.split('/').join('_').split(':').join('_')}-to-${endDate.split('/').join('_').split(':').join('_')}.txt`)
    const eligibleDonationsFilePath = path.resolve(`${__dirname}/../../files/eligibleDonations-${startDate.split('/').join('_').split(':').join('_')}-to-${endDate.split('/').join('_').split(':').join('_')}.csv`)
    writeFileSync(givbackJsonFilePath, JSON.stringify(response, null, 4))
    writeFileSync(givbackCsvFilePath, givbackCsv)
    writeFileSync(eligibleDonationsFilePath, parse(traceDonations.concat(givethDonations).sort((a, b) => {
      return b.createdAt >= a.createdAt ? 1 : -1
    })))
    await sendDiscordMessage({
      file1: givbackCsvFilePath,
      file2: givbackJsonFilePath,
      file3: eligibleDonationsFilePath,
      content: JSON.stringify({
        endDate,
        startDate,
        givAvailable,
        givMaxFactor
      }, null, 4)
    })

  } catch (e) {
    console.log("error happened", e)

  }
}

module.exports = {
  generateEligibleDonations
}
