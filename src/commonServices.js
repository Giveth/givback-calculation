// List of peoples who should not give givbacks
const {gql, request} = require("graphql-request");
const givethiobaseurl = process.env.GIVETHIO_BASE_URL

const configPurpleList = process.env.PURPLE_LIST ? process.env.PURPLE_LIST.split(',').map(address => address.toLowerCase()) : []
const whiteListDonations = process.env.WHITELIST_DONATIONS ? process.env.WHITELIST_DONATIONS.split(',').map(address => address.toLowerCase()) : []
const blackListDonations = process.env.BLACKLIST_DONATIONS ? process.env.BLACKLIST_DONATIONS.split(',').map(address => address.toLowerCase()) : []


const getPurpleList = async () => {
  const query = gql`
        {
          getProjectsRecipients 
        }
    `;

  const result = await request(`${givethiobaseurl}/graphql`, query)
  const purpleList = result.getProjectsRecipients.map(address => address.toLowerCase()).concat(configPurpleList)
  return [...new Set(purpleList)]
}


const filterDonationsWithPurpleList = async (donations) =>{
  const purpleList = await getPurpleList()
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


const purpleListDonations = async (donations) =>{
  const purpleList = await getPurpleList()
  return donations.filter(item => {
    return purpleList.includes(item.giverAddress.toLowerCase())
  })
}


module.exports = {
  filterDonationsWithPurpleList,
  purpleListDonations,
  getPurpleList
}
