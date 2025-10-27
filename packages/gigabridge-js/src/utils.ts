import { Abi,AbiEvent, Address, PublicClient, Log, GetLogsParameters } from 'viem'

/**
 * Returns the smallest bigint.
 */
export function minBigInt(a:bigint,b:bigint) {
    return a < b ? a : b;
}


/**
 * Queries contract events in chunks to handle large block ranges without exceeding RPC limits.
 * Supports optional filtering on indexed event arguments and processing in reverse order.
 * 
 * TODO tutorial why reverse order and maxEvents 
 * TODO implement concurrent
 */
export async function queryEventInChunks({
    client,
    contract,
    eventName,
    eventFilterArgs,
    firstBlock = 0n,
    lastBlock,
    reverseOrder = false,
    maxEvents = Infinity,
    chunkSize = 19999n  // 499n works in basically all cases, but 19999n is far more performant and works for most common rpcs like infura
                        // if you're running your own archive node. You can set it really high.
}: {
    client: PublicClient;
    contract: { address: Address; abi: Abi };
    eventName: string;
    eventFilterArgs?: GetLogsParameters<AbiEvent>['args'];
    firstBlock?: bigint;
    lastBlock?: bigint;
    reverseOrder?: boolean;
    maxEvents?: number;
    chunkSize?: bigint;
}): Promise<Log<bigint, number, false, AbiEvent, true>[]> {
    const address = contract.address;
    const abi = contract.abi;
    lastBlock = lastBlock ?? (await client.getBlockNumber());
    let allEvents: Log<bigint, number, false, AbiEvent, true>[] = [];

    // Find the event ABI based on eventName
    const eventAbi = abi.find((item) => item.type === 'event' && item.name === eventName) as AbiEvent | undefined;
    if (!eventAbi) {
        throw new Error(`Event "${eventName}" not found in ABI`);
    }

    const scanLogic = async (index: bigint) => {
        const start = index * chunkSize + firstBlock;
        const stop = minBigInt(start + chunkSize, lastBlock);
        const logs = await client.getLogs({
            address,
            event: eventAbi,
            args: eventFilterArgs,
            fromBlock: BigInt(start),
            toBlock: BigInt(stop)
        }) as Log<bigint, number, false, AbiEvent, true>[];
        // console.log({ start, stop, events: logs });
        return logs;
    };

    const numIters = Math.ceil(Number(lastBlock - firstBlock) / Number(chunkSize));

    // console.log({ numIters });
    if (reverseOrder) {
        for (let index = BigInt(numIters) - 1n; index >= 0n; index--) {
            const events = await scanLogic(index);
            allEvents = [...events, ...allEvents];
            if (allEvents.length >= maxEvents) {
                break;
            }
        }
    } else {
        for (let index = 0n; index < numIters; index++) {
            const events = await scanLogic(index);
            allEvents = [...allEvents, ...events];
            if (allEvents.length >= maxEvents) {
                break;
            }
        }
    }

    return allEvents;
}