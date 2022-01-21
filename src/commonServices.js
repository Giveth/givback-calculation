// List of peoples who should not give givbacks
const {gql, request} = require("graphql-request");
const {getEthUsdPriceOfGiv} = require("./priceService");
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


const filterDonationsWithPurpleList = async (donations) => {
  console.log('filterDonationsWithPurpleList() called')
  const purpleList = await getPurpleList()
  let filteredDonations = donations.filter(item => {
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

  const batchSize = 5
  const batchNumbers = filteredDonations.length / batchSize
  for (let i = 0; i < batchNumbers; i++) {
    console.log('i, length ', {
      i : i * batchSize,
      length: filteredDonations.length
    })
    filteredDonations = await updateGivPriceForDonations(filteredDonations, i*batchSize, batchSize )
    // const {
    //   txHash,
    //   network,
    //   currency,
    //   valueUsd,
    //   amount
    // } = filteredDonations[i]
    // filteredDonations[i].givPrice = await getGivPriceForDonation({
    //   txHash,
    //   network,
    //   currency,
    //   valueUsd,
    //   amount
    // })
  }
  // console.log('filterred donations', filteredDonations)
  return filteredDonations
}
const updateGivPriceForDonations = async (donations, begin, total) =>{
  const promises = []
  for (let i = begin; i < total; i++) {
    if (i >= donations.length ){
      break;
    }
    console.log('i, length ', {
      i,
      length: donations.length,
    })
    const {
      txHash,
      network,
      currency,
      valueUsd,
      amount
    } = donations[i]
    promises.push(getGivPriceForDonation({
      txHash,
      network,
      currency,
      valueUsd,
      amount
    }))
  }
  const result = await Promise.all(promises)
  for (let i =0 ; i < result.length; i++){
    donations[ begin * total + i ].givPrice = result[i]
    if (isNaN(result[i])){
      console.log('begin * total + i ',begin * total + i, result[i], donations[ begin * total + i ])

    }
  }
  return donations;

}

const getGivPriceForDonation = async ({
                                        txHash,
                                        network,
                                        currency,
                                        valueUsd,
                                        amount
                                      }) => {
  if (currency === 'GIV') {
    return valueUsd / amount
  }
  // console.log("getGivPriceForDonation() ", {
  //   txHash,
  //   network,
  //   currency,
  //   valueUsd,
  //   amount
  // })
  const prices = await getEthUsdPriceOfGiv({
    network,
    txHash
  })
  return prices.givPriceInUsd
}

module.exports = {
  filterDonationsWithPurpleList,
  getPurpleList
}
