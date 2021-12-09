const {gql, request} = require('graphql-request');
const moment = require('moment')
const _ = require('underscore')

const givethiobaseurl = process.env.GIVETHIO_BASE_URL

/**
 *
 * @param beforeDate:string, example: 2021/07/01-00:00:00
 * @param endDate:string, example: 2021/07/12-00:00:00
 * @returns {Promise<[{totalAmount:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" }]>}
 */
const getDonationsReport = async (beforeDate, endDate) => {
  try {
    const timeFormat = 'YYYY/MM/DD-HH:mm:ss';
    const firstDate = moment(beforeDate, timeFormat);
    if (String(firstDate) === 'Invalid date'){
      throw new Error('Invalid startDate')
    }
    const secondDate = moment(endDate, timeFormat);

    if (String(secondDate) === 'Invalid date'){
      throw new Error('Invalid endDate')
    }
    const query = gql`
        {
          donations {
            valueUsd  
            createdAt
            project {
              giveBacks
              verified
            }
            fromWalletAddress
            status
          }
        }
    `;

    const result = await request(`${givethiobaseurl}/graphql`, query)
    const donations = result.donations
      .filter(
      donation =>
        moment(donation.createdAt) < secondDate
        && moment(donation.createdAt) > firstDate
        && donation.valueUsd
        && donation.project.verified
        && donation.status ==='verified'
        // && donation.project.giveBacks
    )

    const groups = _.groupBy(donations, 'fromWalletAddress')
    return  _.map(groups, function(value, key) {
      return {
        giverAddress: key.toLowerCase(),
        totalAmount: _.reduce(value, function(total, o) {
          return total + o.valueUsd;
        }, 0)
      };
    });

  } catch (e) {
    console.log('error in getting givethio donations', e)
    throw e
  }
}

module.exports = {
  getDonationsReport
}
