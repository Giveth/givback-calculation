const axios = require('axios')
const moment = require("moment");
const {filterDonationsWithPurpleList} = require('./commonServices')
const _ = require("underscore");

const traceBaseUrl = process.env.TRACE_BASE_URL


/**
 *
 * @param beginDate:string, example: 2021/07/01-00:00:00
 * @param endDate:string, example: 2021/07/12-00:00:00
 * @returns {Promise<[{amount:400, currency:"GIV",createdAt:"",
 * valueUsd:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9",
 * source:'trace.giveth.io', txHash:"", network:"mainnet"}]>}
 */
const getEligibleDonations = async (beginDate, endDate) => {
  try {
    /**
     * @see @link{https://feathers.beta.giveth.io/docs/?url=/docs#/verifiedProjectsGiversReport/get_verifiedProjectsGiversReport}
     */
    const url = `${traceBaseUrl}/verifiedProjectsGiversReport?fromDate=${beginDate}&toDate=${endDate}&allProjects=true`
    const result = (await axios.get(url)).data.data
    const donations = [];
    for (const giverData of result) {
      for (const donation of giverData.donations) {
        donations.push(
          {
            amount: donation.amount,
            currency: donation.token,
            createdAt: moment(donation.createdAt).format('YYYY-MM-DD-hh:mm:ss'),
            valueUsd: donation.usdValue,
            giverAddress: donation.giverAddress,
            txHash: donation.homeTxHash,

            //We just have donation over mainnet network on trace
            network:'mainnet',

            source: 'trace.giveth.io'
          }
        )
      }
    }
    return filterDonationsWithPurpleList(donations)

  } catch (e) {
    console.log('getEligibleDonations() error', {
      error: e,
      beginDate, endDate
    })
    throw e
  }
}

/**
 *
 * @param beforeDate:string, example: 2021/07/01-00:00:00
 * @param endDate:string, example: 2021/07/12-00:00:00
 * @returns {Promise<[{totalDonationsUsdValue:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" }]>}
 */
const getDonationsReport = async (beforeDate, endDate) => {

  const donations = await getEligibleDonations(beforeDate, endDate)
  const groups = _.groupBy(donations, 'giverAddress')
  return _.map(groups, function (value, key) {
    return {
      giverName: value[0].giverName,
      giverEmail: value[0].giverEmail,
      giverAddress: key.toLowerCase(),
      totalDonationsUsdValue: _.reduce(value, function (total, o) {
        return total + o.valueUsd;
      }, 0)
    };
  });

}

module.exports = {
  getDonationsReport,
  getEligibleDonations
}
