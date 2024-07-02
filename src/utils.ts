import {DonationResponse, GivethIoDonation, MinimalDonation} from "./types/general";
import {hexlify, ethers} from "ethers";
import { keccak256 } from "@ethersproject/keccak256";
import { toUtf8Bytes } from "@ethersproject/strings";


const Web3 = require('web3');
const {pinJSONToIPFS} = require("./pinataUtils");
const _ = require('underscore');
const axios = require('axios');

export const convertMinimalDonationToDonationResponse = (params: {
  minimalDonationsArray: MinimalDonation[],
  niceDonationsWithShare?: MinimalDonation[],
  raisedValueSum: number,
  givPrice: number
}): DonationResponse[] => {
  const {
    minimalDonationsArray, raisedValueSum,
    givPrice
  } = params
  return minimalDonationsArray.map((item: MinimalDonation) => {
    const share = item.totalDonationsUsdValueAfterGivFactor / raisedValueSum;
    const givback = (item.totalDonationsUsdValueAfterGivFactor / givPrice)
    const totalDonationsUsdValueAfterGivFactor = Number(item.totalDonationsUsdValueAfterGivFactor.toFixed(7))
    const totalDonationsUsdValue = Number(item.totalDonationsUsdValue.toFixed(7))
    return {
      giverAddress: item.giverAddress,
      giverEmail: item.giverEmail,
      giverName: item.giverName,
      totalDonationsUsdValueAfterGivFactor,
      totalDonationsUsdValue,

      totalReferralDeductedUsdValue: item.totalReferralDeductedUsdValue,
      totalReferralDeductedUsdValueAfterGivFactor: item.totalReferralDeductedUsdValueAfterGivFactor,
      totalReferralAddedUsdValue: item.totalReferralAddedUsdValue,
      totalReferralAddedUsdValueAfterGivFactor: item.totalReferralAddedUsdValueAfterGivFactor,

      averageGivbackFactor: (totalDonationsUsdValueAfterGivFactor / totalDonationsUsdValue).toFixed(7),
      givback: Number(givback.toFixed(7)),
      givbackUsdValue: (givback * givPrice).toFixed(7),
      share: Number(share.toFixed(7)),
    }
  }).filter(item => {
    return item.share > 0
  })
}

export const getDonationsForSmartContractParams = (params: {
  groupByGiverAddress: any,
  maxGivbackFactorPercentage: number
}): MinimalDonation[] => {
  const {groupByGiverAddress, maxGivbackFactorPercentage} = params
  return _.map(groupByGiverAddress, (value: MinimalDonation[], key: string) => {
    const totalDonationsUsdValue = _.reduce(value, (total: number, o: MinimalDonation) => {
      return total + o.totalDonationsUsdValue;
    }, 0)
    const totalDonationsUsdValueAfterGivFactor = _.reduce(value, (total: number, o: MinimalDonation) => {
      return total + o.totalDonationsUsdValueAfterGivFactor * maxGivbackFactorPercentage;
    }, 0)
    return {
      giverAddress: key.toLowerCase(),
      giverEmail: value[0].giverEmail,
      giverName: value[0].giverName,

      totalReferralDeductedUsdValue: value[0].totalReferralDeductedUsdValue,
      totalReferralDeductedUsdValueAfterGivFactor: value[0].totalReferralDeductedUsdValueAfterGivFactor,
      totalReferralAddedUsdValue: value[0].totalReferralAddedUsdValue,
      totalReferralAddedUsdValueAfterGivFactor: value[0].totalReferralAddedUsdValueAfterGivFactor,

      totalDonationsUsdValue,
      totalDonationsUsdValueAfterGivFactor,
      averageGivbackFactor: (totalDonationsUsdValueAfterGivFactor / totalDonationsUsdValue).toFixed(7)
    };
  });
}

// check variables always
export const createSmartContractCallAddBatchParams = async (params: {
  nrGIVAddress: string,
  donationsWithShare: DonationResponse[],
  givRelayerAddress: string,
  network : 'gnosis' | 'optimism'
}, maxAddressesPerFunctionCall: number): Promise<{
  result: string,
  hashParams: string
}> => {
  try {
    const {
      donationsWithShare,
      givRelayerAddress,
      network
    } = params;
    if (donationsWithShare.length === 0) {
      throw new Error('There is no eligible donations in this time range')
    }

    // Make sure maxAddressesPerFunctionCall is a number and is greater than 0
    if (!Number(maxAddressesPerFunctionCall) || maxAddressesPerFunctionCall <= 0) {
      throw new Error('maxAddressesPerFunctionCall should be a number greater than 0')
    }
    const partNumbers = donationsWithShare.length / maxAddressesPerFunctionCall
    const hashParams: any = {
      ipfsLink: '',
    }
    console.log('createSmartContractCallAddBatchParams', {
      givRelayerAddress,
      network
    })
    let nonce = await getLastNonceForWalletAddress(givRelayerAddress, network)
    const rawDatasForHash = []
    for (let i = 0; i < partNumbers; i++) {
      const smartContractBatchData = getSmartContractAddBatchesHash(
        {
          donationsWithShare: donationsWithShare.slice(i * maxAddressesPerFunctionCall, (i + 1) * maxAddressesPerFunctionCall),
          nonce
        }
      )
      const hash = smartContractBatchData.hash
      rawDatasForHash.push(smartContractBatchData.rawData)
      hashParams[hash] = {
        rawData: smartContractBatchData.rawData
      }
      nonce += 1
    }
    const ipfsHash = await pinJSONToIPFS({jsonBody: rawDatasForHash})
    const result = `load giveth; giveth:initiate-givbacks ${ipfsHash} --relayer ${givRelayerAddress}`;
    hashParams.ipfsLink = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`
    return {
      result,
      hashParams
    };
  } catch (e) {
    console.log('createSmartContractCallAddBatchParams error', e)
    throw e
  }
}



const getSmartContractAddBatchesHash = (params: {
  donationsWithShare: DonationResponse[],
  nonce: number
}) => {
  const {
    donationsWithShare,
    nonce
  } = params
  const rawData = {
    nonce,
    amounts: donationsWithShare.map(
      givback => String(
        convertExponentialNumber(givback.givback * 10 ** 18)
      )
    ),
    recipients: donationsWithShare.map(({giverAddress}) => giverAddress),

  }
  console.log('rawData \n', rawData )
  const hash = hashBatchEthers(rawData)
  return {hash, rawData}
}


const convertExponentialNumber = (n: number) => {
  const sign = +n < 0 ? "-" : "",
    toStr = n.toString();
  if (!/e/i.test(toStr)) {
    return n;
  }
  const [lead, decimal, pow] = n.toString()
    .replace(/^-/, "")
    .replace(/^([0-9]+)(e.*)/, "$1.$2")
    .split(/e|\./);
  return Number(pow) < 0
    ? sign + "0." + "0".repeat(Math.max(Math.abs(Number(pow)) - 1 || 0, 0)) + lead + decimal
    : sign + lead + (+pow >= decimal.length ? (decimal + "0".repeat(Math.max(+pow - decimal.length || 0, 0))) : (decimal.slice(0, +pow) + "." + decimal.slice(+pow)))
}


function hashBatchEthers(params: {
  nonce: number,
  recipients: string[],
  amounts: string[]
}) {
  const {
    nonce,
    recipients,
    amounts
  } = params
  console.log('hashBatchEthers() input', {nonce, recipients, amounts})
  const encodedData = ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address[]", "uint256[]"], [nonce, recipients, amounts]);

  const hash = hexlify(
    keccak256(
      toUtf8Bytes(encodedData)
    ),
  );
  console.log('hashBatchEthers() hash', hash);

  return hash;
}

const xdaiWeb3NodeUrl = process.env.XDAI_NODE_HTTP_URL
const xdaiWeb3 = new Web3(xdaiWeb3NodeUrl);

const optimismWeb3NodeUrl = process.env.OPTIMISM_NODE_HTTP_URL
const optimismWeb3 = new Web3(optimismWeb3NodeUrl);

export const getLastNonceForWalletAddress = async (walletAddress: string, chain: 'gnosis' | 'optimism'): Promise<number> => {
  const web3Provider = chain === 'optimism' ? optimismWeb3 : xdaiWeb3
  const userTransactionsCount = await web3Provider.eth.getTransactionCount(
    walletAddress
  );
  console.log('getLastNonceForWalletAddress ', {
    userTransactionsCount,
    chain,
    walletAddress
  })
  // prevent sending negative nonce
  return Math.max(userTransactionsCount - 1, 0)
}


export const getNetworkNameById = (networkId: number): string => {
  switch (networkId) {
    case 1:
      return 'mainnet'
    case 3:
      return 'ropsten'
    case 5:
      return 'goerli'
    case 10 :
      return 'optimism'
    case 420 :
      return 'optimism-goerli'
    case 100 :
      return 'gnosis'
    case 137:
      return 'polygon'
    case 42220:
      return 'celo'
    case 61 :
      return 'etc'
    default:
      return String(networkId)
  }
}

export const filterRawDonationsByChain = (gqlResult: { donations: GivethIoDonation[] }, chain ?: "all-other-chains" | "optimism"): GivethIoDonation[] => {
  if (chain === 'optimism') {
    return gqlResult.donations.filter(donation => donation.transactionNetworkId === 10 || donation.transactionNetworkId === 420)
  } else if (chain === "all-other-chains") {
    // Exclude Optimism donations and return all other donations
    return gqlResult.donations.filter(donation => donation.transactionNetworkId !== 10 && donation.transactionNetworkId !== 420)
  } else {
    return gqlResult.donations
  }


}
const referralSharePercentage = Number(process.env.REFERRAL_SHARE_PERCENTAGE) || 10

export const calculateReferralReward = (valueUsd: number): number => {
  return valueUsd * (referralSharePercentage / 100)
}
export const calculateReferralRewardFromRemainingAmount = (valueUsdAfterDeduction: number): number => {
  const originalValue = valueUsdAfterDeduction * 100 / (100 - referralSharePercentage)
  return calculateReferralReward(originalValue)
}

export const getBlockByTimestamp = async (timestamp: number, chainId: number) :Promise<number>=> {
  try {
    const url = `https://api.findblock.xyz/v1/chain/${chainId}/block/before/${timestamp}?inclusive=true`
    console.log('getBlockByTimestamp url', url)
    const response = await axios.get(url)
    return response.data.number
  } catch (e) {
    console.log('getBlockByTimestamp error', e)
    return 0
  }
}
