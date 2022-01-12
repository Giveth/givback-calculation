/**
 *
 * @param givbacks [{
 "giverAddress": string,
 "givback": number,
 }]
 * @returns {string}
 */
const createSmartContractCallParams = ({
                                         distributorAddress,
                                         nrGIVAddress,
                                         tokenDistroAddress,
                                         donationsWithShare
                                       }, maxAddressesPerFunctionCall) => {
  const response = {}
  const partNumbers = donationsWithShare.length / maxAddressesPerFunctionCall
  for (let i = 0; i < partNumbers; i++) {
    response[`smartContractCallParams-${i+1}`] = getSmartContractParamsPart({
      distributorAddress,
      nrGIVAddress,
      tokenDistroAddress,
      donationsWithShare: donationsWithShare.slice(i*maxAddressesPerFunctionCall, (i+1)*maxAddressesPerFunctionCall)
    })
  }
  return response;
}

const getSmartContractParamsPart = ({
                                      distributorAddress,
                                      nrGIVAddress,
                                      tokenDistroAddress,
                                      donationsWithShare
                                    }) => {
  let result = `connect ${nrGIVAddress} token-manager voting act ${distributorAddress} ${tokenDistroAddress} `;
  result += 'sendGIVbacks(address[],uint256[]) ['
  for (let i = 0; i < donationsWithShare.length; i++) {
    if (i > 0) {
      // We should not put comma before first wallet address, so we do tihs checking
      result += ','
    }
    result += donationsWithShare[i].giverAddress
  }
  result += '] ['
  result += `${donationsWithShare.map(givback => convertExponentialNumber(givback.givback * 10 ** 18))}`
  result += ']'
  return result
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

module.exports = {
  createSmartContractCallParams
}
