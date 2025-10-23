
import { IMT, IMTHashFunction, IMTNode } from "@zk-kit/imt"
import { poseidon2Hash } from "@zkpassport/poseidon2"
import GigaBridgeArtifact from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"}
import { IGigaBridge$Type } from "../../gigabridge-contracts/artifacts/contracts/gigabridge/interfaces/IGigaBridge.sol/artifacts.js"
import { Address, Client, getContract, PublicClient, WalletClient, GetContractReturnType, Transaction, Hash, parseEventLogs, ParseEventLogsReturnType, ParseEventLogsParameters, ExtractAbiItem } from "viem";
// TODO default address
const GIGA_BRIDGE_ADDRESS: Address = "0x0000000000000000000000000000000000000000"
const poseidon2IMTHashFunc:IMTHashFunction = (nodes:IMTNode[])=>poseidon2Hash(nodes as bigint[]) as IMTNode

// TODO complain viem doesn't do this for me!
type NewSyncTreeEventArgs = {args: {syncTreeIndex: bigint,leafValues: bigint[],leafIndexes: bigint[]}}
type NewSyncTreeEvent = ParseEventLogsParameters<typeof GigaBridgeArtifact.abi, "NewSyncTree", true> & NewSyncTreeEventArgs

export async function getSyncTree(txHash: Hash, publicClient: PublicClient, gigaBridgeAddress = GIGA_BRIDGE_ADDRESS) {
    // TODO complain that this doesn't work
    // const latestBlock = await publicClient.getBlockNumber();
    const gigaBridge = getContract({
        abi: GigaBridgeArtifact.abi,
        client: { public: publicClient, wallet: undefined },
        address: gigaBridgeAddress,
    })
    // const events = await gigaBridge.getEvents.LeafRegistered({ fromBlock: 0n, toBlock: latestBlock })
    // console.log({events})

    const txReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
    const syncTreeEvents = parseEventLogs({
        abi: GigaBridgeArtifact.abi,
        eventName: 'NewSyncTree',
        logs: txReceipt.logs,
    }) as any as NewSyncTreeEvent[];

    const trees = []
    for (const syncTreeEvent of syncTreeEvents) {
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
        const depth = Math.ceil(Math.log2(syncTreeLeafs.length))
        const tree = new IMT(poseidon2IMTHashFunc, depth, 0n, 2, syncTreeLeafs)
        trees.push(tree)
    }

    return trees
}
