const {ethers} = require("ethers");
const Web3 = require('web3');
const {pinJSONToIPFS} = require("./pinataUtils");
const {hexlify, solidityKeccak256} = ethers.utils;


const createSmartContractCallAddBatchParams = async ({
                                                       nrGIVAddress,
                                                       donationsWithShare,
                                                       relayerAddress
                                                     }, maxAddressesPerFunctionCall) => {
  const partNumbers = donationsWithShare.length / maxAddressesPerFunctionCall
  let result = `connect ${nrGIVAddress} token-manager voting:1 act agent:0 ${relayerAddress} `;
  result += 'addBatches(bytes32[],bytes) ['
  const hashParams = {
    ipfsLink:''
  }
  let nonce = await getLastNonceForWalletAddress(relayerAddress)
  const rawDatasForHash  = []
  for (let i = 0; i < partNumbers; i++) {
    if (i !== 0){
      result += ','
    }
    const smartContractBatchData =  getSmartContractAddBatchesHash(
      {
        donationsWithShare: donationsWithShare.slice(i * maxAddressesPerFunctionCall, (i + 1) * maxAddressesPerFunctionCall),
        nonce
      }
    )
    const hash = smartContractBatchData.hash
    rawDatasForHash.push(smartContractBatchData.rawData)
    result += `${hash}`
    hashParams[hash] = {
      rawData:smartContractBatchData.rawData
    }
    nonce += 1
  }
  const ipfsHash = await pinJSONToIPFS({jsonBody: rawDatasForHash})
  result+=`] ${ipfsHash}`
  hashParams.ipfsLink = `https://gateway.pinata.cloud/ipfs/${ipfsHash}`
  return {
    result,
    hashParams
  };
}



const getSmartContractAddBatchesHash =  ({
                                          donationsWithShare,
                                          nonce
                                        }) => {
  const rawData =  {
    nonce,
    amounts: donationsWithShare.map(
      givback => String(
        convertExponentialNumber(givback.givback * 10 ** 18)
      )
    ),
    recipients: donationsWithShare.map(({giverAddress}) => giverAddress),

  }
  const hash =  hashBatchEthers(rawData)
  return { hash, rawData}
}


const convertExponentialNumber = (n) => {
  const sign = +n < 0 ? "-" : "",
    toStr = n.toString();
  if (!/e/i.test(toStr)) {
    return n;
  }
  const [lead, decimal, pow] = n.toString()
    .replace(/^-/, "")
    .replace(/^([0-9]+)(e.*)/, "$1.$2")
    .split(/e|\./);
  return +pow < 0
    ? sign + "0." + "0".repeat(Math.max(Math.abs(pow) - 1 || 0, 0)) + lead + decimal
    : sign + lead + (+pow >= decimal.length ? (decimal + "0".repeat(Math.max(+pow - decimal.length || 0, 0))) : (decimal.slice(0, +pow) + "." + decimal.slice(+pow)))
}


function hashBatchEthers({
                           nonce,
                           recipients,
                           amounts
                         }) {
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

const getLastNonceForWalletAddress = async (walletAddress) => {
  const userTransactionsCount = await xdaiWeb3.eth.getTransactionCount(
    walletAddress
  );
  return userTransactionsCount - 1
}

module.exports = {
  createSmartContractCallAddBatchParams,
  getLastNonceForWalletAddress
}
