const axios = require('axios')
const moment = require("moment");
const {gql, request} = require("graphql-request");
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
    return donations

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
 * @returns {Promise<[{totalAmount:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" }]>}
 */
const getDonationsReport = async (beforeDate, endDate) => {
  /**
   * @see @link{https://feathers.beta.giveth.io/docs/?url=/docs#/verifiedProjectsGiversReport/get_verifiedProjectsGiversReport}
   */
  const url = `${traceBaseUrl}/verifiedProjectsGiversReport?fromDate=${beforeDate}&toDate=${endDate}&allProjects=true`
  const result = (await axios.get(url)).data.data
  return result.map(item => {
    return {
      totalAmount: item.totalAmount,
      giverAddress: item.giverAddress.toLowerCase()
    }
  })

}

module.exports = {
  getDonationsReport,
  getEligibleDonations
}
