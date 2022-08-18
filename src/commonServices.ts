// List of peoples who should not give givbacks
import {FormattedDonation} from "./types/general";

const {gql, request} = require("graphql-request");
const givethiobaseurl = process.env.GIVETHIO_BASE_URL

const configPurpleList = process.env.PURPLE_LIST ? process.env.PURPLE_LIST.split(',').map(address => address.toLowerCase()) : []
const whiteListDonations = process.env.WHITELIST_DONATIONS ? process.env.WHITELIST_DONATIONS.split(',').map(address => address.toLowerCase()) : []
const blackListDonations = process.env.BLACKLIST_DONATIONS ? process.env.BLACKLIST_DONATIONS.split(',').map(address => address.toLowerCase()) : []


export const getPurpleList = async ():Promise<string[]> => {
  const query = gql`
        {
          getProjectsRecipients 
        }
    `;

  const result = await request(`${givethiobaseurl}/graphql`, query)
  const purpleList = result.getProjectsRecipients.map((address :string)=> address.toLowerCase()).concat(configPurpleList)
  return [...new Set(purpleList)] as string[]
}


export const filterDonationsWithPurpleList = async (donations:FormattedDonation[], disablePurpleList = false)  :Promise<FormattedDonation[]>=>{
  const purpleList = disablePurpleList ? [] : await getPurpleList()
  return donations.filter(item => {
    const isGiverPurpleList = purpleList.includes(item.giverAddress.toLowerCase())
    const isDonationWhitelisted = whiteListDonations.includes(item.txHash.toLowerCase())
    const isDonationBlacklisted = blackListDonations.includes(item.txHash.toLowerCase())
    if (isDonationWhitelisted){
      // It's important to check whitelist before purpleList
      return true
    }
    if (isDonationBlacklisted || isGiverPurpleList){
      return false;
    }
    return true
  })
}


export const purpleListDonations = async (donations:FormattedDonation[], disablePurpleList = false):Promise<FormattedDonation[]> =>{
  const purpleList = disablePurpleList ? [] : await getPurpleList()
  return donations.filter(item => {
    return purpleList.includes(item.giverAddress.toLowerCase())
  })
}

