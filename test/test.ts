import { getCurrentGIVbacksRound, getGIVbacksRound } from "../src/givethIoService";
import { getBlockbyTimestamp } from "../src/utils";
import {getEthGivPriceInMainnet, getEthPriceTimeStamp} from "../src/priceService";
// getGIVbacksRound(55).then((res) => {
//   console.log("res", res);
// });

// getBlockbyTimestamp(1707511725, 100).then((res) => {
//   console.log("res", res);
// });


// const getPriceInfo = async (roundNumber: number) => {
//     const givAvailable = 1000000
//     const {start, end} = await getGIVbacksRound(Number(roundNumber))
//     const endDate = Math.floor(new Date(end).getTime() / 1000)
//     const priceBlock = await getBlockbyTimestamp(endDate, 1)
//     console.log("priceBlock", priceBlock);
//     const givPriceInETH = await getEthGivPriceInMainnet(priceBlock)
//     const ethPrice = await getEthPriceTimeStamp(endDate)
//     const givpriceInUSD = givPriceInETH * ethPrice
//     const givWorth = givAvailable * givpriceInUSD

//     return [givpriceInUSD, givWorth, endDate]
// }

// getPriceInfo(55).then((res) => {
//     console.log("res", res);
// });

getCurrentGIVbacksRound().then((res) => {
    console.log("res", res);
});