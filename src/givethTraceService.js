const axios = require('axios')
const traceBaseUrl = process.env.TRACE_BASE_URL || 'https://feathers.beta.giveth.io'
// const traceBaseUrl = process.env.TRACE_BASE_URL

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
  const url = `${traceBaseUrl}/verifiedProjectsGiversReport?fromDate=${beforeDate}&toDate=${endDate}&allProjects=false`
  const result = (await axios.get(url)).data.data
  return result.map(item =>{
      return {
          totalAmount: item.totalAmount,
          giverAddress:item.giverAddress.toLowerCase()
      }
  })
}

module.exports = {
  getDonationsReport
}