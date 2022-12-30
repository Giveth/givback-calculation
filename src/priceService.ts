const axios = require('axios')
const Web3 = require('web3');
const {Pool} = require("@uniswap/v3-sdk");
const { Token } = require('@uniswap/sdk-core');
const givEconomyXdaiSubgraphUrl = 'https://api.thegraph.com/subgraphs/name/giveth/giveth-economy-xdai'
const givEconomyMainnetSubgraphUrl = 'https://api.thegraph.com/subgraphs/name/giveth/giveth-economy-mainnet'
const xdaiWeb3 = new Web3('https://dry-small-sound.xdai.quiknode.pro');
const mainnetWeb3 = new Web3(process.env.MAINNET_NODE_URL);

export const getEthGivPriceInXdai = async (blockNumber:number) => {
  const query = blockNumber ? `{
        pairs(block: {number : ${blockNumber}}) {
            reserve0
            reserve1
            token0
            token1
        }
      }
    ` : `{
        pairs {
            reserve0
            reserve1
            token0
            token1
        }
      }
    `;
  const requestBody = {query}
  const result = await axios.post(givEconomyXdaiSubgraphUrl, requestBody)
  console.log('getEthGivPrice ', {
    resultData: result.data,
    requestBody
  })
  const pair = result.data && result.data.data && result.data.data.pairs && result.data.data.pairs[0]
  if (!pair) {
    throw new Error('There is no ETH/GIV price in this block')
  }
  return pair.reserve1 / pair.reserve0
}

export const getEthGivPriceInMainnet = async (blockNumber:number):Promise<number> => {
  const uniswapV3PoolAddress = '0xc763b6b3d0f75167db95daa6a0a0d75dd467c4e1'
  const query = blockNumber ? `{
          uniswapV3Pool(id: "${uniswapV3PoolAddress}", block: {number : ${blockNumber}}) {
            id
            token0
            token1
            liquidity
            sqrtPriceX96
            tick
          }
        }
    ` : `{
          uniswapV3Pool(id: "${uniswapV3PoolAddress}") {
            id
            token0
            token1
            liquidity
            sqrtPriceX96
            tick
          }
        }`
  ;
  const requestBody = {query}
  const result = await axios.post(givEconomyMainnetSubgraphUrl, requestBody)
    console.log('result.data  ', result.data)

    const uniswapV3Pool = result.data && result.data.data && result.data.data.uniswapV3Pool;
  if (!uniswapV3Pool) {
    throw new Error('There is no ETH/GIV price in this block')
  }
  const givTokenAddress = "0x900db999074d9277c5da2a43f252d74366230da0";
  const wethTokenAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

  const givToken = new Token(
    1,
    givTokenAddress,
    18,
    'GIV',
    'GIV',
  );
  const wethToken = new Token(
    1,
    wethTokenAddress,
    18,
    'WETH',
    'WETH',
  );
  const givIsFirstToken = uniswapV3Pool.token0.toLowerCase() === givTokenAddress.toLowerCase()
  const firstToken = givIsFirstToken ? givToken : wethToken
  const secondToken = givIsFirstToken ? wethToken : givToken
  const pool = new Pool(
    firstToken,
    secondToken,
    3000,
    Number(uniswapV3Pool.sqrtPriceX96),
    Number(uniswapV3Pool.liquidity),
    Number(uniswapV3Pool.tick),
  );
  return Number(pool.priceOf(givToken).toFixed(10))
}


export const getEthPriceTimeStamp = async (timestampInSeconds:number):Promise<number> => {
  const cryptoCompareUrl = 'https://min-api.cryptocompare.com/data/dayAvg'
  const result = await axios.get(cryptoCompareUrl, {
    params: {
      fsym: 'ETH',
      tsym: 'USD',
      toTs: timestampInSeconds
    }
  });
  return result.data.USD

}

export const getTimestampOfBlock = async (blockNumber:number, network:string) : Promise<number> => {

  const block = await getWebProvider(network).eth.getBlock(blockNumber);
  if (!block) {
    throw new Error('getTimestampOfBlock() invalid blockNumber ' + blockNumber)
  }
  return block.timestamp;
}

export const getBlockNumberOfTxHash = async (txHash:string, network:string) : Promise<number> => {
  const transaction = await getWebProvider(network).eth.getTransaction(
    txHash,
  );
  if (!transaction) {
    throw new Error('transaction not found')
  }
  return transaction.blockNumber
}

const getWebProvider = (network:string) => {
  return network === 'mainnet' ? mainnetWeb3 : xdaiWeb3;
}

