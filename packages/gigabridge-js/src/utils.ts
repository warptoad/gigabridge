import { Abi, AbiEvent, Address, PublicClient, Log, GetLogsParameters } from 'viem'
import { GigaBridgeContract } from './types.js';
import { GigaBridgeContractTestType } from '../../gigabridge-contracts/src/index.js';

/**
 * Returns the smallest bigint.
 */
export function minBigInt(a: bigint, b: bigint) {
    return a < b ? a : b;
}

/**
 * Queries contract events in chunks to handle large block ranges without exceeding RPC limits.
 * Supports optional filtering on indexed event arguments and processing in reverse order.
 * reverseOrder scans in reverse order but returns it in the normal order
 * 
 * TODO tutorial why reverse order and maxEvents 
 * TODO implement concurrent
 * 
 */
export async function queryEventInChunks<
  const TAbi extends Abi,
  const TEventName extends string,
  TAbiEvent extends AbiEvent = Extract<TAbi[number], AbiEvent & { name: TEventName }>
>({
    publicClient,
    contract,
    eventName,
    eventFilterArgs,
    firstBlock = 0n,
    lastBlock,
    reverseOrder = false,
    maxEvents = Infinity,
    chunkSize = 19999n,
    postQueryFilter,
}: {
    publicClient: PublicClient;
    contract: { address: Address; abi: TAbi };
    eventName: TEventName;
    eventFilterArgs?: GetLogsParameters<TAbiEvent>['args']; 
    firstBlock?:bigint;
    lastBlock?: bigint;
    reverseOrder?: boolean;
    maxEvents?: number;
    chunkSize?: bigint;
    postQueryFilter?:(events:Log<bigint, number, false, TAbiEvent, true>[])=>Log<bigint, number, false, TAbiEvent, true>[];
}): Promise<Log<bigint, number, false, TAbiEvent, true>[]> { 
    const address = contract.address;
    const abi = contract.abi;
    
    lastBlock ??= await publicClient.getBlockNumber(); 
    let allEvents: Log<bigint, number, false, TAbiEvent, true>[] = [];

    // Find the event ABI based on eventName (now fully typed)
    const eventAbi = abi.find((item) => item.type === 'event' && item.name === eventName) as TAbiEvent | undefined;
    if (!eventAbi) {
        throw new Error(`Event "${String(eventName)}" not found in ABI`);
    }

    const scanLogic = async (index: bigint) => {
        const start = index * chunkSize + firstBlock;
        const stop = minBigInt(start + chunkSize, lastBlock);
        const logs = await publicClient.getLogs({
            address,
            event: eventAbi,
            args: eventFilterArgs,
            fromBlock: start,
            toBlock: stop
        }) as Log<bigint, number, false, TAbiEvent, true>[];
        return logs;
    };

    const range = lastBlock - firstBlock;
    const numIters = Math.ceil(Number(range) / Number(chunkSize));

    if (reverseOrder) {
        for (let index = BigInt(numIters - 1); index >= 0n; index--) {
            const events = await scanLogic(index);
            allEvents = [...events, ...allEvents];
            if (postQueryFilter) {
                allEvents = postQueryFilter(allEvents)
            }
            if (allEvents.length >= maxEvents) break;
        }
    } else {
        for (let index = 0n; index < BigInt(numIters); index++) {
            const events = await scanLogic(index);
            allEvents = [...allEvents, ...events];
            if (postQueryFilter) {
                allEvents = postQueryFilter(allEvents)
            }
            if (allEvents.length >= maxEvents) break;
        }
    }

    return allEvents; 
}