import {FormattedDonation, GivethIoDonation, MinimalDonation} from "./types/general";

const {gql, request} = require('graphql-request');
const moment = require('moment')
const _ = require('underscore')

import {filterDonationsWithPurpleList, purpleListDonations} from './commonServices'

const givethiobaseurl = process.env.GIVETHIO_BASE_URL

/**
 *
 * @returns {Promise<[{amount:400, currency:"GIV",createdAt:"",
 * valueUsd:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" ,
 * source:'giveth.io'}]>}
 * @param params
 */
export const getEligibleDonations = async (
    params: {
        beginDate: string,
        endDate: string,
        niceWhitelistTokens?: string[],
        niceProjectSlugs?: string[],
        eligible?: boolean,
        disablePurpleList?: boolean,
        justCountListed?: boolean
    }): Promise<FormattedDonation[]> => {
    try {
        const {
            beginDate,
            endDate,
            niceWhitelistTokens,
            niceProjectSlugs,
            disablePurpleList,
            justCountListed
        } = params
        const eligible = params.eligible === undefined ? true : params.eligible
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
        let donationsToVerifiedProjects: GivethIoDonation[] = result.donations
            .filter(
                (donation: GivethIoDonation) =>
                    moment(donation.createdAt) < secondDate
                    && moment(donation.createdAt) > firstDate
                    && donation.valueUsd
                    && donation.isProjectVerified
                    && donation.status === 'verified'
            )

        let donationsToNotVerifiedProjects: GivethIoDonation[] = result.donations
            .filter(
                (donation: GivethIoDonation) =>
                    moment(donation.createdAt) < secondDate
                    && moment(donation.createdAt) > firstDate
                    && donation.valueUsd
                    && !donation.isProjectVerified
                    && donation.status === 'verified'
            )

        if (niceWhitelistTokens) {
            donationsToVerifiedProjects = donationsToVerifiedProjects
                .filter(
                    (donation: GivethIoDonation) =>
                        niceWhitelistTokens.includes(donation.currency))

            donationsToNotVerifiedProjects = donationsToNotVerifiedProjects
                .filter(
                    (donation: GivethIoDonation) =>
                        niceWhitelistTokens.includes(donation.currency)
                )
        }

        if (niceProjectSlugs) {
            donationsToVerifiedProjects = donationsToVerifiedProjects
                .filter(
                    donation =>
                        niceProjectSlugs.includes(donation.project.slug))

            donationsToNotVerifiedProjects = donationsToNotVerifiedProjects
                .filter(
                    donation =>
                        niceProjectSlugs.includes(donation.project.slug)
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

        const formattedDonationsToNotVerifiedProjects: FormattedDonation[] = donationsToNotVerifiedProjects.map(item => {
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
            params
        })
        throw e
    }
}

export const getVerifiedPurpleListDonations = async (beginDate: string, endDate: string) => {
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
                (donation: GivethIoDonation) =>
                    moment(donation.createdAt) < secondDate
                    && moment(donation.createdAt) > firstDate
                    && donation.valueUsd
                    && donation.isProjectVerified
                    && donation.status === 'verified'
            )


        const formattedDonationsToVerifiedProjects = donationsToVerifiedProjects.map((item: GivethIoDonation) => {
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
 * @param niceWhitelistTokens
 * @param niceProjectSlugs
 * @returns {Promise<[{totalDonationsUsdValue:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" }]>}
 */
export const getDonationsReport = async (beginDate: string, endDate: string,
                                         niceWhitelistTokens ?: string[], niceProjectSlugs ?: string[]): Promise<MinimalDonation[]> => {
    try {
        const donations = await getEligibleDonations(
            {
                beginDate, endDate,
                niceWhitelistTokens,
                niceProjectSlugs,
                disablePurpleList: Boolean(niceWhitelistTokens)
            })

        const groups = _.groupBy(donations, 'giverAddress')
        return _.map(groups, (value: FormattedDonation[], key: string) => {
            return {
                giverName: value[0].giverName,
                giverEmail: value[0].giverEmail,
                giverAddress: key.toLowerCase(),
                totalDonationsUsdValue: _.reduce(value, function (total: number, o: FormattedDonation) {
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
 * @param params
 * @returns {Promise<[{totalDonationsUsdValue:320, givethAddress:"0xf74528c1f934b1d14e418a90587e53cbbe4e3ff9" }]>}
 */
//TODO After doing https://forum.giveth.io/t/retroactive-givbacks/412 this should be deleted
export const getDonationsReportRetroactive = async (beginDate: string, endDate: string, params: {
    eligible?: boolean,
    justCountListed?: boolean,
    toGiveth?: boolean
}): Promise<MinimalDonation[]> => {
    const {justCountListed, toGiveth} = params;
    const eligible = params.eligible === undefined ? true : params.eligible

    try {
        const donations = (await getEligibleDonations(
            {
                beginDate, endDate, eligible, justCountListed,
                disablePurpleList: true

            }
        )).filter(
            (donation: FormattedDonation) => toGiveth ?
                donation.projectLink === 'https://giveth.io/project/the-giveth-community-of-makers' :
                donation.projectLink !== 'https://giveth.io/project/the-giveth-community-of-makers'
        )

        const groups = _.groupBy(donations, 'giverAddress')
        return _.map(groups, (value: FormattedDonation[], key: string) => {
            return {
                giverName: value[0].giverName,
                giverEmail: value[0].giverEmail,
                giverAddress: key.toLowerCase(),
                totalDonationsUsdValue: _.reduce(value, function (total: number, o: MinimalDonation) {
                    return total + o.valueUsd;
                }, 0)
            };
        });

    } catch (e) {
        console.log('error in getting givethio donations', e)
        throw e
    }
}

