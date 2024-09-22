// List of peoples who should not give givbacks
import {FormattedDonation, GivbackFactorParams, GivethIoDonation} from "./types/general";

const {gql, request} = require("graphql-request");
const givethiobaseurl = process.env.GIVETHIO_BASE_URL

const configPurpleList = process.env.PURPLE_LIST ? process.env.PURPLE_LIST.split(',').map(address => address.toLowerCase()) : []
const whiteListDonations = process.env.WHITELIST_DONATIONS ? process.env.WHITELIST_DONATIONS.split(',').map(address => address.toLowerCase()) : []
const blackListDonations = process.env.BLACKLIST_DONATIONS ? process.env.BLACKLIST_DONATIONS.split(',').map(address => address.toLowerCase()) : []

// Related to admin bro
export const getPurpleList = async (): Promise<string[]> => {
    const query = gql`
        {
          getPurpleList
        }
    `;

    const result = await request(`${givethiobaseurl}/graphql`, query)
    const purpleList = result.getPurpleList.map((address: string) => address.toLowerCase()).concat(configPurpleList)
    return [...new Set(purpleList)] as string[]
}


export const filterDonationsWithPurpleList = async (donations: FormattedDonation[], disablePurpleList = false): Promise<FormattedDonation[]> => {
    const purpleList = disablePurpleList ? [] : await getPurpleList()
    return donations.filter(item => {
        const isGiverPurpleList = purpleList.includes(item.giverAddress.toLowerCase())
        const isDonationWhitelisted = whiteListDonations.includes(item.txHash.toLowerCase())
        const isDonationBlacklisted = blackListDonations.includes(item.txHash.toLowerCase())
        if (isDonationWhitelisted) {
            // It's important to check whitelist before purpleList
            return true
        }
        if (isDonationBlacklisted || isGiverPurpleList) {
            return false;
        }
        return true
    })
}


export const purpleListDonations = async (donations: FormattedDonation[], disablePurpleList = false): Promise<FormattedDonation[]> => {
    const purpleList = disablePurpleList ? [] : await getPurpleList()
    return donations.filter(item => {
        return purpleList.includes(item.giverAddress.toLowerCase())
    })
}


export const donationValueAfterGivFactor = (params: {
    usdValue: number,
    givFactor: number
}):number => {
    const {usdValue, givFactor}  = params
    return Number(
        (usdValue * givFactor).toFixed(7)
    )
}
export const groupDonationsByParentRecurringId = (
  donations: GivethIoDonation[]
): GivethIoDonation[] => {
    const groupedDonations: GivethIoDonation[] = [];

    // Create a map to group donations by parentRecurringDonationId
    const donationMap = donations.reduce((map, donation) => {
        const parentRecurringDonationId = donation.recurringDonation?.id;
        if (parentRecurringDonationId) {
            if (!map[parentRecurringDonationId]) {
                map[parentRecurringDonationId] = [];
            }
            map[parentRecurringDonationId].push(donation);
        } else {
            // If there is no parentRecurringDonationId, add directly to the grouped donations
            groupedDonations.push({
                ...donation,
                amount: donation.amount, // Convert amount to number
            });
        }
        return map;
    }, {} as Record<string, GivethIoDonation[]>);

    // Iterate through the map to create grouped donations
    for (const parentId in donationMap) {
        const donationsGroup = donationMap[parentId];

        // Use the data of the first donation in the group
        const firstDonation = donationsGroup[0];

        // Sum the amounts, valueUsd, and valueUsdAfterGivbackFactor
        const totalAmount = donationsGroup.reduce((sum, donation) => sum + parseFloat(donation.amount), 0);
        const totalValueUsd = donationsGroup.reduce((sum, donation) => sum + donation.valueUsd, 0);

        // Create a new grouped donation object
        const groupedDonation: GivethIoDonation = {
            ...firstDonation,
            amount: String(totalAmount),
            valueUsd: totalValueUsd,
            numberOfStreamedDonations: donationsGroup.length,
        };

        groupedDonations.push(groupedDonation);
    }

    return groupedDonations;
};
