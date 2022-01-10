const axios = require('axios')
const Web3 =require('web3');

const givEconomySubgraphUrl  = 'https://api.thegraph.com/subgraphs/name/giveth/giveth-economy-xdai'
const xdaiWeb3 = new Web3('https://dry-small-sound.xdai.quiknode.pro');

const getEthGivPrice = async (blockNumber) =>{
    const query = blockNumber ?  `{
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
    const requestBody= {query}
    const result = await axios.post(givEconomySubgraphUrl, requestBody)
    console.log('getEthGivPrice ', {
        resultData: result.data,
        requestBody
    } )
    const pair = result.data && result.data.data && result.data.data.pairs && result.data.data.pairs[0]
    if (!pair){
        throw new Error('There is no ETH/GIV price in this block')
    }
    return  pair.reserve1/pair.reserve0
}


const getEthPriceTimeStamp = async (timestampInSeconds)=>{
    const cryptoCompareUrl = 'https://min-api.cryptocompare.com/data/dayAvg'
    const result = await axios.get(cryptoCompareUrl, {
        params:{
            fsym:'ETH',
            tsym:'USD',
            toTs: timestampInSeconds
        }
    });
    return result.data.USD

}

const getTimestampOfBlock = async (blockNumber) =>{
    const block = await xdaiWeb3.eth.getBlock(blockNumber);
    if (!block){
        throw new Error('getTimestampOfBlock() invalid blockNumber '+ blockNumber)
    }
    return block.timestamp;
}

const getBlockNumberOfTxHash = async (txHash) =>{
    const transaction = await xdaiWeb3.eth.getTransaction(
      txHash,
    );
    if (!transaction) {
        throw new Error('transaction not found')
    }
    return transaction.blockNumber
}

module.exports ={
    getEthGivPrice,
    getEthPriceTimeStamp,
    getBlockNumberOfTxHash,
    getTimestampOfBlock
}
