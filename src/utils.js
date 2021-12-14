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
  for (let i = 0; i < givbacks.length; i++) {
    if (i > 0) {
      // We should not put comma before first wallet address, so we do tihs checking
      result += ','
    }
    result += givbacks[i].giverAddress
  }
  result += ']['
  // result+=`${givbacks.map(givback=>givback.givback)}`
  result += `${givbacks.map(givback => convertExponentialNumber(givback.givback * 10 ** 18))}`
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
