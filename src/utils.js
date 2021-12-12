/**
 *
 * @param givbacks [{
   "giverAddress": string,
   "givback": number,
 }]
 * @returns {string}
 */
const createSmartContractCallParams = (givbacks) => {
  let result = 'sendGIVbacks(address[],uint256[]) ['
  for (let i=0; i < givbacks.length; i++) {
    if (i > 0) {
      // We should not put comma before first wallet address, so we do tihs checking
      result += ','
    }
    result += givbacks[i].giverAddress
  }
  result += ']['
  result+=`${givbacks.map(givback=>givback.givback* 10**18)}`
  result +=']'
  return result
}

module.exports = {
  createSmartContractCallParams
}
