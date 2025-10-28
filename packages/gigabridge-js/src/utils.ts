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
 * Fetches contract events in chunks to avoid RPC limits on big block ranges.
 * Can filter on indexed args and scan backwards (latest first) but returns in normal order (earliest first).
 *
 * Reverse order helps when you want recent events first, so you can stop early with maxEvents without scanning everything.
 * maxEvents lets you quit once you hit enough events, saving RPC calls.
 *
 * Note: No concurrency implemented. This usually messes with rate limits on most RPCs. For local setups, just bump up chunkSize.
 *
 * @param {PublicClient} args.publicClient
 * @param {{ address: Address; abi: TAbi }} args.contract - the viem contract object (returned from getContract)
 * @param {TEventName} args.eventName 
 * @param {GetLogsParameters<TAbiEvent>['args']} [args.eventFilterArgs] - Filters for indexed parameters (this is passed to publicClient.getLogs aka eth_getLog)
 * @param {bigint} [args.firstBlock] - Start block (inclusive). Defaults to 0n.
 * @param {bigint} [args.lastBlock] - End block (inclusive). Defaults to current block.
 * @param {boolean} [args.reverseOrder] - Scan latest to earliest, but returns the normal order.
 * @param {number} [args.maxEvents] - Max events to fetch; stops early if hit. (events are counted after postQueryFilter is applied)
 * @param {bigint} [args.chunkSize] - amount of block will be requested with eth_getLogs
 * @param {(events: Log<bigint, number, false, TAbiEvent, true>[]) => Log<bigint, number, false, TAbiEvent, true>[]} [args.postQueryFilter] - Filter applied after events are queried.
 *
 * @returns {Promise<Log<bigint, number, false, TAbiEvent, true>[]>} Array of event logs, earliest to latest.
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
            if (allEvents.length >= maxEvents) {console.log(`stopped scanning at chunk ${index}/${numIters-1}`);break};
        }
    } else {
        for (let index = 0n; index < BigInt(numIters); index++) {
            const events = await scanLogic(index);
            allEvents = [...allEvents, ...events];
            if (postQueryFilter) {
                allEvents = postQueryFilter(allEvents)
            }
            if (allEvents.length >= maxEvents) {console.log(`stopped scanning at chunk ${index}/${numIters-1}`);break};
        }
    }

    return allEvents; 
}