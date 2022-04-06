const axios = require('axios')
const moment = require("moment");
const {filterDonationsWithPurpleList, purpleListDonations} = require('./commonServices')
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
const getEligibleDonations = async (beginDate, endDate, eligible = true) => {
  try {
    /**
     * @see @link{https://feathers.giveth.io/docs/?url=/docs#/verifiedProjectsGiversReport/get_verifiedProjectsGiversReport}
     */
    const verifiedProjectDonationsUrl = `${traceBaseUrl}/verifiedProjectsGiversReport?fromDate=${beginDate}&toDate=${endDate}&projectType=verified`
    const unVerifiedProjectDonationsUrl = `${traceBaseUrl}/verifiedProjectsGiversReport?fromDate=${beginDate}&toDate=${endDate}&projectType=unVerified`
    const verifiedDonationsResult = (await axios.get(verifiedProjectDonationsUrl)).data.data
    const unVerifiedDonationsResult = (await axios.get(unVerifiedProjectDonationsUrl)).data.data
      console.log("trace donations length", {
        verifiedProjectDonationsUrl,
        unVerifiedProjectDonationsUrl,
        verifiedDonationsResultLength: verifiedDonationsResult.length,
        unVerifiedDonationsResultLength: unVerifiedDonationsResult.length
      })
    const unVerifiedDonations = formatDonations(unVerifiedDonationsResult);
    const verifiedDonations = formatDonations(verifiedDonationsResult);
    return  eligible ?
      await filterDonationsWithPurpleList(verifiedDonations):
      (await purpleListDonations(verifiedDonations)).concat(unVerifiedDonations)

  } catch (e) {
    console.log('getEligibleDonations() error', {
      error: e,
      beginDate, endDate
    })
    throw e
  }
}

const getVerifiedPurpleListDonations = async (beginDate, endDate) => {
  try {
    /**
     * @see @link{https://feathers.giveth.io/docs/?url=/docs#/verifiedProjectsGiversReport/get_verifiedProjectsGiversReport}
     */
    const verifiedProjectDonationsUrl = `${traceBaseUrl}/verifiedProjectsGiversReport?fromDate=${beginDate}&toDate=${endDate}&projectType=verified`
    const verifiedDonationsResult = (await axios.get(verifiedProjectDonationsUrl)).data.data
    const verifiedDonations = formatDonations(verifiedDonationsResult);
    return await purpleListDonations(verifiedDonations)

  } catch (e) {
    console.log('getEligibleDonations() error', {
      error: e,
      beginDate, endDate
    })
    throw e
  }
}

function formatDonations (donationResult){
  const donations = []
  for (const giverData of donationResult) {
    for (const donation of giverData.donations) {
      donations.push(
        {
          amount: donation.amount,
          currency: donation.token,
          createdAt: moment(donation.createdAt).format('YYYY-MM-DD-hh:mm:ss'),
          valueUsd: donation.usdValue,
          giverAddress: donation.giverAddress,
          txHash: donation.homeTxHash,
          giverName : `https://trace.giveth.io/profile/${donation.giverAddress}`,
          info: donation.projectInfo && `${donation.projectInfo.type}: ${donation.projectInfo.title}`,

          //We just have donation over mainnet network on trace
          network:'mainnet',

          source: 'trace.giveth.io'
        }
      )
    }
  }
  return donations
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
/**
 *
 * @param beforeDate:string, example: 2021/07/01-00:00:00
 * @param endDate:string, example: 2021/07/12-00:00:00
 * @returns {Promise<[{totalDonationsUsdValue:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" }]>}
 */
//TODO After doing https://forum.giveth.io/t/retroactive-givbacks/412 this should be deleted
const getDonationsReportRetroactive = async (beforeDate, endDate,{
  eligible = true,
  toGiveth
}) => {
  const donations = (await getEligibleDonations(beforeDate, endDate,
    eligible)).filter(
    donation => toGiveth ?
      donation.info === 'Campaign: Giveth DApp Development' :
      donation.info !== 'Campaign: Giveth DApp Development'
  )
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
  getEligibleDonations,
  getVerifiedPurpleListDonations,
  getDonationsReportRetroactive
}
