
import { IMT } from "@zk-kit/imt"
import GigaBridgeArtifact from "../../giga-bridge-contracts/artifacts/contracts/giga-bridge/GigaBridge.sol/GigaBridge.json" with {type: "json"}
import { IGigaBridge$Type } from "../../giga-bridge-contracts/artifacts/contracts/giga-bridge/interfaces/IGigaBridge.sol/artifacts.ts"
import { Address, Client, getContract, PublicClient, WalletClient, GetContractReturnType, Transaction, Hash, parseEventLogs, ParseEventLogsReturnType, ParseEventLogsParameters, ExtractAbiItem } from "viem";
// TODO default address
const GIGA_BRIDGE_ADDRESS: Address = "0x0000000000000000000000000000000000000000"


// TODO complain viem doesn't do this for me!
type NewSyncTreeEventArgs = {args: {syncTreeIndex: bigint,leafValues: bigint[],leafIndexes: bigint[]}}
type NewSyncTreeEvent = ParseEventLogsParameters<typeof GigaBridgeArtifact.abi, "NewSyncTree", true> & NewSyncTreeEventArgs

export async function getSyncTree(txHash: Hash, publicClient: PublicClient, gigaBridgeAddress = GIGA_BRIDGE_ADDRESS) {
    // TODO complain that this doesn't work
    // const latestBlock = await publicClient.getBlockNumber();
    // const gigaBridge = getContract({
    //     abi: GigaBridgeArtifact.abi,
    //     client: { public: publicClient, wallet: undefined },
    //     address: gigaBridgeAddress,
    // })
    // const events = await gigaBridge.getEvents.LeafRegistered({ fromBlock: 0n, toBlock: latestBlock })
    // console.log({events})

    const txReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
    const syncTreeEvent = parseEventLogs({
        abi: GigaBridgeArtifact.abi,
        eventName: 'NewSyncTree',
        logs: txReceipt.logs,
    })[0] as any as NewSyncTreeEvent;

    const leafIndexes = syncTreeEvent.args.leafIndexes
    const leafValues = syncTreeEvent.args.leafValues
    let syncTreeLeafs:bigint[] = []
    let prevLeafIndex=0n;
    for (let i = 0; i < leafIndexes.length; i++) {
        const gap = leafIndexes[i] - prevLeafIndex - 1n
        if (gap > 0n) {
            syncTreeLeafs = [...syncTreeLeafs, ...new Array(Number(gap)).fill(0n)]
        }
        syncTreeLeafs.push(leafValues[i])
        prevLeafIndex = leafIndexes[i]
    }
    console.log({syncTreeLeafs})
    return syncTreeLeafs
}
