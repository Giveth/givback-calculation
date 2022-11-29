import Web3 from "web3";
import axios from "axios";

const GIV_CONTRACT_ADDRESS = '0x4f4f9b8d5b4d0dc10506e5551b0513b61fd59e75'
const G_GIV_CONTRACT_ADDRESS = '0xffbabeb49be77e5254333d5fdff72920b989425f'
const subgraphAddress = process.env.GIV_ECONOMY_SUBGRAPH_URL as string

const getTokenBalancesQuery = (params: {
    tokenAddress: string,
    whitelistUsers: string[],
    skip: number
}) => {
    const {
        tokenAddress,
        whitelistUsers,
        skip
    } = params
    let users = `[`
    for (const walletAddress of whitelistUsers) {
        users += `"${walletAddress}",`
    }
    users += ']'
    return `
        {
          tokenBalances (
              first: 50
              skip: ${skip}
              where: {
                token:"${tokenAddress}",
                user_in : ${users}
              }
          ){
              balance
              user {
                  id
              }
          }
        
        }
`
}

const getClaimedAmountQuery = (minClaimAmount: string, skip: number) => {
    return `
        {
          tokenDistroBalances(
              first: 50
              skip: ${skip}
               where: {
                claimed_gte:"${minClaimAmount}"
              } 
          ) {
            user{
                id
            }  
            claimed
          }
        }
`
}

const getClaimedAmountData = async (minAirdrop: string):
    Promise<{ walletAddress: string, claimedAmount: number }[]> => {
    let skip = 0;
    let data: {
        user: { id: string },
        claimed: string
    }[] = []
    let fetchData = true;
    while (fetchData) {
        const requestBody = {query: getClaimedAmountQuery(minAirdrop, skip)}
        const result = await axios.post(subgraphAddress, requestBody)
        if (result?.data?.data?.tokenDistroBalances?.length > 0) {
            data = data.concat(result.data.data.tokenDistroBalances)
            skip += result.data.data.tokenDistroBalances.length
        } else {
            fetchData = false
        }
    }


    return data.map(
        (item: {
             user: { id: string },
             claimed: string
         }
        ) => {
            return {
                walletAddress: item.user.id,
                claimedAmount: Number(Web3.utils.fromWei(item.claimed, 'ether'))
            }
        })
}

const getBalanceData = async (tokenAddress: string, whitelistUsers: string[]):
    Promise<{ walletAddress: string, balance: number }[]> => {
    let skip = 0;
    let data: {
        user: { id: string },
        balance: string
    }[] = []
    let fetchData = true;
    while (fetchData) {
        const requestBody = {
            query: getTokenBalancesQuery({
                skip,
                tokenAddress,
                whitelistUsers
            })
        }
        const result = await axios.post(subgraphAddress, requestBody);
        if (result?.data?.data?.tokenBalances?.length > 0) {
            data = data.concat(result.data.data.tokenBalances)
            skip += result.data.data.tokenBalances.length
        } else {
            fetchData = false
        }

    }
    return data.map(
        (item: {
             user: { id: string },
             balance: string
         }
        ) => {
            return {
                walletAddress: item.user.id,
                balance: Number(Web3.utils.fromWei(item.balance, 'ether'))
            }
        })
}

export const get_dumpers_list = async (params: {
    minGivHold: string,
    minTotalClaimed: string
}) => {
    const {minGivHold, minTotalClaimed} = params;
    const minBalance = Web3.utils.toWei(minGivHold, 'ether')
    const minAirdrop = Web3.utils.toWei(minTotalClaimed, 'ether')

    try {
        const claimedData = await getClaimedAmountData(minAirdrop)
        const walletAddresses = claimedData.map(
            item => item.walletAddress
        )
        const givBalanceData = await getBalanceData(GIV_CONTRACT_ADDRESS, walletAddresses)
        const gGivBalanceData = await getBalanceData(G_GIV_CONTRACT_ADDRESS, walletAddresses)
        const result: {
            walletAddress: string,
            totalClaimed: number,
            givBalance: number,
            gGivBalance: number,
        } [] = []
        claimedData.forEach(item => {
            const walletAddress = item.walletAddress
            const givBalance = givBalanceData.find(balanceData => balanceData.walletAddress === walletAddress)?.balance || 0
            const gGivBalance = gGivBalanceData.find(balanceData => balanceData.walletAddress === walletAddress)?.balance || 0
            if (
                (givBalance + gGivBalance) <= Number(minGivHold)
            ) {
                result.push({
                    walletAddress,
                    totalClaimed: item.claimedAmount,
                    givBalance,
                    gGivBalance,
                })
            }

        })
        return {count: result.length, result}
    } catch (e) {
        console.log('get_dumpers_list error', e)
        throw e
    }

}
