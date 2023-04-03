import {DonationResponse} from "./types/general";

const {ethers} = require("ethers");
const Web3 = require('web3');
const {pinJSONToIPFS} = require("./pinataUtils");
const {hexlify, solidityKeccak256} = ethers.utils;

// check variables always
export const createSmartContractCallAddBatchParams = async (params: {
  nrGIVAddress: string,
  donationsWithShare: DonationResponse[],
  givRelayerAddress: string
}, maxAddressesPerFunctionCall: number) => {
  const {
    donationsWithShare,
    givRelayerAddress
  } = params;
  if (donationsWithShare.length === 0) {
    throw new Error('There is no eligible donations in this time range')

  }
  const partNumbers = donationsWithShare.length / maxAddressesPerFunctionCall
  const hashParams: any = {
    ipfsLink: '',
  }
  let nonce = await getLastNonceForWalletAddress(givRelayerAddress)
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
  const hash = hexlify(
    solidityKeccak256(
      ["uint256", "address[]", "uint256[]"],
      [nonce, recipients, amounts],
    ),
  );
  console.log('hashBatchEthers() hash', hash);

  return hash;
}

const xdaiWeb3NodeUrl = process.env.XDAI_NODE_HTTP_URL
const xdaiWeb3 = new Web3(xdaiWeb3NodeUrl);

export const getLastNonceForWalletAddress = async (walletAddress: string): Promise<number> => {
  const userTransactionsCount = await xdaiWeb3.eth.getTransactionCount(
    walletAddress
  );
  return userTransactionsCount - 1
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
      return 'optimistic'
    case 100 :
      return 'gnosis'
    case 137:
      return 'polygon'
    default:
      return 'unknown network'
  }
}

const referralSharePercentage = Number(process.env.REFERRAL_SHARE_PERCENTAGE) ||10

export const calculateReferralReward = (valueUsd: number) :number=>{
  return valueUsd * (referralSharePercentage/100)
}
export const calculateReferralRewardFromRemainingAmount = (valueUsdAfterDeduction: number) :number=>{
  const originalValue = valueUsdAfterDeduction * 100 /(100- referralSharePercentage)
  return calculateReferralReward(originalValue)
}
