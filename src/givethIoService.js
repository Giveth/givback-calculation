const {gql, request} = require('graphql-request');
const moment = require('moment')
const _ = require('underscore')

const {filterDonationsWithPurpleList, purpleListDonations} = require('./commonServices')

const givethiobaseurl = process.env.GIVETHIO_BASE_URL

/**
 *
 * @param beginDate:string, example: 2021/07/01-00:00:00
 * @param endDate:string, example: 2021/07/12-00:00:00
 * @returns {Promise<[{amount:400, currency:"GIV",createdAt:"",
 * valueUsd:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" ,
 * source:'giveth.io'}]>}
 */
const getEligibleDonations = async (beginDate, endDate, eligible = true) => {
  try {
    const timeFormat = 'YYYY/MM/DD-HH:mm:ss';
    const firstDate = moment(beginDate, timeFormat);
    if (String(firstDate) === 'Invalid date') {
      throw new Error('Invalid startDate')
    }
    const secondDate = moment(endDate, timeFormat);

    if (String(secondDate) === 'Invalid date') {
      throw new Error('Invalid endDate')
    }
    const query = gql`
        {
          donations {
            valueUsd  
            createdAt
            currency
            transactionId
            transactionNetworkId
            amount
            project {
              slug
              verified
            }
            user {
              name
              email
            }
            fromWalletAddress
            status
          }
        }
    `;

    const result = await request(`${givethiobaseurl}/graphql`, query)
    let donationsToVerifiedProjects = result.donations
      .filter(
        donation =>
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && donation.project.verified
          && donation.status === 'verified'
      )

    let donationsToNotVerifiedProjects = result.donations
      .filter(
        donation =>
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && !donation.project.verified
          && donation.status === 'verified'
      )


    const formattedDonationsToVerifiedProjects = donationsToVerifiedProjects.map(item => {
      return {
        amount: item.amount,
        currency: item.currency,
        createdAt: moment(item.createdAt).format('YYYY-MM-DD-hh:mm:ss'),
        valueUsd: item.valueUsd,
        giverAddress: item.fromWalletAddress,
        txHash: item.transactionId,
        network: item.transactionNetworkId === 1 ? 'mainnet' : 'xDAI',
        source: 'giveth.io',
        giverName: item && item.user && item.user.name,
        giverEmail: item && item.user && item.user.email,
        projectLink: `https://giveth.io/project/${item.project.slug}`,
      }
    });

    const formattedDonationsToNotVerifiedProjects = donationsToNotVerifiedProjects.map(item => {
      return {
        amount: item.amount,
        currency: item.currency,
        createdAt: moment(item.createdAt).format('YYYY-MM-DD-hh:mm:ss'),
        valueUsd: item.valueUsd,
        giverAddress: item.fromWalletAddress,
        txHash: item.transactionId,
        network: item.transactionNetworkId === 1 ? 'mainnet' : 'xDAI',
        source: 'giveth.io',
        giverName: item && item.user && item.user.name,
        giverEmail: item && item.user && item.user.email,
        projectLink: `https://giveth.io/project/${item.project.slug}`,
      }
    });
    return eligible ?
      await filterDonationsWithPurpleList(formattedDonationsToVerifiedProjects) :
      (await purpleListDonations(formattedDonationsToVerifiedProjects)).concat(formattedDonationsToNotVerifiedProjects)

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
    const timeFormat = 'YYYY/MM/DD-HH:mm:ss';
    const firstDate = moment(beginDate, timeFormat);
    if (String(firstDate) === 'Invalid date') {
      throw new Error('Invalid startDate')
    }
    const secondDate = moment(endDate, timeFormat);

    if (String(secondDate) === 'Invalid date') {
      throw new Error('Invalid endDate')
    }
    const query = gql`
        {
          donations {
            valueUsd  
            createdAt
            currency
            transactionId
            transactionNetworkId
            amount
            project {
              slug
              verified
            }
            user {
              name
              email
            }
            fromWalletAddress
            status
          }
        }
    `;

    const result = await request(`${givethiobaseurl}/graphql`, query)
    let donationsToVerifiedProjects = result.donations
      .filter(
        donation =>
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && donation.project.verified
          && donation.status === 'verified'
      )


    const formattedDonationsToVerifiedProjects = donationsToVerifiedProjects.map(item => {
      return {
        amount: item.amount,
        currency: item.currency,
        createdAt: moment(item.createdAt).format('YYYY-MM-DD-hh:mm:ss'),
        valueUsd: item.valueUsd,
        giverAddress: item.fromWalletAddress,
        txHash: item.transactionId,
        network: item.transactionNetworkId === 1 ? 'mainnet' : 'xDAI',
        source: 'giveth.io',
        giverName: item && item.user && item.user.name,
        giverEmail: item && item.user && item.user.email,
        projectLink: `https://giveth.io/project/${item.project.slug}`,
      }
    });

    return await purpleListDonations(formattedDonationsToVerifiedProjects)

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
 * @param beginDate:string, example: 2021/07/01-00:00:00
 * @param endDate:string, example: 2021/07/12-00:00:00
 * @returns {Promise<[{totalDonationsUsdValue:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" }]>}
 */
const getDonationsReport = async (beginDate, endDate) => {
  try {
    const donations = await getEligibleDonations(beginDate, endDate)

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

  } catch (e) {
    console.log('error in getting givethio donations', e)
    throw e
  }
}

module.exports = {
  getDonationsReport,
  getEligibleDonations,
  getVerifiedPurpleListDonations
}
