const Ethers = require("ethers");

const abi =
  '[{"anonymous":false,"inputs":[{"indexed":true,"internalType":"address","name":"admin","type":"address"},{"indexed":true,"internalType":"address","name":"distributor","type":"address"},{"indexed":false,"internalType":"uint256","name":"amount","type":"uint256"}],"name":"Assign","type":"event"}]';
let iface = new Ethers.Interface(abi);


type getAssignHistoryType = {
  total: number,
  assignHistory: {
    blockNumber: number,
    transactionHash: string,
    amount: number
  }[]
}

export async function getAssignHistory(params: {
  tokenDistroAddress: string,
  uniPoolAddress: string,
  rpcUrl: string
}): Promise<getAssignHistoryType> {
  const {tokenDistroAddress, uniPoolAddress, rpcUrl} = params;
  const provider = new Ethers.JsonRpcProvider(rpcUrl);

  const contract = new Ethers.ethers.Contract(tokenDistroAddress, abi, provider);
  const filter = contract.filters.Assign(null, uniPoolAddress);
  const _events = await contract.queryFilter(filter);
  const assignHistory: getAssignHistoryType["assignHistory"] = [];

  let total = 0n;
  // @ts-ignore
  _events.forEach((_event) => {
    const {transactionHash, blockNumber} = _event;
    /**
     * args is like:
     *  {
          fragment: EventFragment {
            type: 'event',
            inputs: [ [ParamType], [ParamType], [ParamType] ],
            name: 'Assign',
            anonymous: false
          },
          name: 'Assign',
          signature: 'Assign(address,address,uint256)',
          topic: '0x007ae6a979e5d8177867f7c1ca4be1527487a2e43a444b55c3dfaee02c423544',
          args: Result(3) [
            '0x4D9339dd97db55e3B9bCBE65dE39fF9c04d1C2cd',
            '0xD93d3bDBa18ebcB3317a57119ea44ed2Cf41C2F2',
            4825500000000000000000000n
          ]
        }
     */
    const args = iface.parseLog(_event as unknown as { topics: string[]; data: string});
    console.log('args: ', args)
    // Assuming `amount` is a BigInt.
    const amountBigInt = BigInt(args.args[2]);

    // Perform division using BigInt and then convert to Number for storing
    // const amountNumber = Number(amountBigInt / 10n ** 18n);
    const amountNumber = Ethers.ethers.formatEther(amountBigInt.toString());
    assignHistory.push({
      blockNumber,
      transactionHash,
      amount: amountNumber,
    })
    console.log(`
    Block: ${blockNumber}
    Transaction Hash: ${transactionHash}
    Amount: ${amountNumber}
    -----------------------------------------------
    `);
    total += amountBigInt;
  });

  console.log("###############################################");
  console.log("Total: ", total / 10n ** 18n);
  console.log("Total: ", Ethers.ethers.formatEther(total.toString()));
  return {
    total: Ethers.ethers.formatEther(total.toString()),
    assignHistory: assignHistory.reverse()
  }
}

