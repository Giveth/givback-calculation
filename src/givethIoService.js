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
const getEligibleDonations = async (
  {
    beginDate,
    endDate,
    whitelistTokens = undefined,
    projectSlugs = undefined,
    eligible = true,
    disablePurpleList = false,
    justCountListed = false
  }) => {
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

    // givethio get time in this format YYYYMMDD HH:m:ss
    const fromDate = beginDate.split('/').join('').replace('-', ' ')
    const toDate = endDate.split('/').join('').replace('-', ' ')
    const query = gql`
        {
          donations(
              fromDate:"${fromDate}", 
              toDate:"${toDate}"
          ) {
            valueUsd  
            createdAt
            currency
            transactionId
            transactionNetworkId
            amount
            isProjectVerified
            project {
              slug
              verified
              listed
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
          && donation.isProjectVerified
          && donation.status === 'verified'
      )

    let donationsToNotVerifiedProjects = result.donations
      .filter(
        donation =>
          moment(donation.createdAt) < secondDate
          && moment(donation.createdAt) > firstDate
          && donation.valueUsd
          && !donation.isProjectVerified
          && donation.status === 'verified'
      )

    if (whitelistTokens) {
      donationsToVerifiedProjects = donationsToVerifiedProjects
        .filter(
          donation =>
            whitelistTokens.includes(donation.currency))

      donationsToNotVerifiedProjects = donationsToNotVerifiedProjects
        .filter(
          donation =>
            whitelistTokens.includes(donation.currency)
        )
    }

    if (projectSlugs) {
      donationsToVerifiedProjects = donationsToVerifiedProjects
        .filter(
          donation =>
            projectSlugs.includes(donation.project.slug))

      donationsToNotVerifiedProjects = donationsToNotVerifiedProjects
        .filter(
          donation =>
            projectSlugs.includes(donation.project.slug)
        )
    }

    if (justCountListed) {
      donationsToNotVerifiedProjects = donationsToNotVerifiedProjects
        .filter(
          donation =>
            donation.project.listed
        )
      donationsToVerifiedProjects = donationsToVerifiedProjects
        .filter(
          donation =>
            donation.project.listed
        )
    }
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
      await filterDonationsWithPurpleList(formattedDonationsToVerifiedProjects, disablePurpleList) :
      (await purpleListDonations(formattedDonationsToVerifiedProjects, disablePurpleList)).concat(formattedDonationsToNotVerifiedProjects)

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
    // givethio get time in this format YYYYMMDD HH:m:ss
    const fromDate = beginDate.split('/').join('').replace('-', ' ')
    const toDate = endDate.split('/').join('').replace('-', ' ')
    const query = gql`
        {
          donations(
              fromDate:"${fromDate}", 
              toDate:"${toDate}"
          ) {
            valueUsd  
            createdAt 
            currency
            transactionId
            transactionNetworkId
            amount
            isProjectVerified
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
          && donation.isProjectVerified
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
const getDonationsReport = async (beginDate, endDate, whitelistTokens, projectSlugs) => {
  try {
    const donations = await getEligibleDonations(
      {
        beginDate, endDate,
        whitelistTokens,
        projectSlugs
      })

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


/**
 *
 * @param beginDate:string, example: 2021/07/01-00:00:00
 * @param endDate:string, example: 2021/07/12-00:00:00
 * @returns {Promise<[{totalDonationsUsdValue:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" }]>}
 */
//TODO After doing https://forum.giveth.io/t/retroactive-givbacks/412 this should be deleted
const getDonationsReportRetroactive = async (beginDate, endDate, {
  eligible = true,
  justCountListed = false,
  toGiveth
}) => {
  try {
    const donations = (await getEligibleDonations(
      {
        beginDate, endDate, eligible, justCountListed,
        disablePurpleList: true

      }
    )).filter(
      donation => toGiveth ?
        donation.projectLink === 'https://giveth.io/project/the-giveth-community-of-makers' :
        donation.projectLink !== 'https://giveth.io/project/the-giveth-community-of-makers'
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

  } catch (e) {
    console.log('error in getting givethio donations', e)
    throw e
  }
}

module.exports = {
  getDonationsReport,
  getEligibleDonations,
  getVerifiedPurpleListDonations,
  getDonationsReportRetroactive
}
