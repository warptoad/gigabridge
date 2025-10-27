
import { IMT, IMTHashFunction, IMTNode } from "@zk-kit/imt"
import { poseidon2Hash } from "@zkpassport/poseidon2"
//import GigaBridgeArtifact from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"} 
import { IGigaBridge$Type } from "../../gigabridge-contracts/artifacts/contracts/gigabridge/interfaces/IGigaBridge.sol/artifacts.js"
import { Address, Client, getContract, PublicClient, WalletClient, GetContractReturnType, Transaction, Hash, parseEventLogs, ParseEventLogsReturnType, ParseEventLogsParameters, ExtractAbiItem, Abi } from "viem";
//import {GigaBridgeContractWritableType } from "./types.js";
import { type GigaBridge$Type }  from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js"
import { GigaBridgeArtifact, GigaBridgeContractTestType } from "../../gigabridge-contracts/src/index.js";
import { GigaBridgeContractWithWalletClient, GigaBridgeContract } from "./types.js";

// i hate typescript, this the one way to turn the fucking json thing into const and viem needs that otherwise it just forgets what function you can call on gigaBridge.write.
const gigaBridgeAbi = [...GigaBridgeArtifact.abi] as const; 

// TODO default address
const GIGA_BRIDGE_ADDRESS: Address = "0x0000000000000000000000000000000000000000"
const poseidon2IMTHashFunc:IMTHashFunction = (nodes:IMTNode[])=>poseidon2Hash(nodes as bigint[]) as IMTNode


export async function getSyncTree({txHash, gigaBridge ,publicClient}:{txHash:Hash, publicClient:PublicClient, gigaBridge: GigaBridgeContract|GigaBridgeContractTestType}) {
    const txReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
    const syncTreeEvents = parseEventLogs({
        abi: gigaBridge.abi,
        eventName: 'NewSyncTree',
        logs: txReceipt.logs,
    });

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

export async function registerNewLeaf({args ,gigaBridge, client:{publicClient, wallet}}:{args:[owner:Address,updater:Address,value:bigint],gigaBridge: GigaBridgeContractWithWalletClient|GigaBridgeContractTestType,client:{ publicClient:PublicClient, wallet:WalletClient} }):Promise<bigint> {
    const txHash = await (gigaBridge as GigaBridgeContractWithWalletClient).write.registerNewLeaf(args, { account: wallet.account ?? null, chain: wallet.chain })
    const txReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
    const registerEvent = parseEventLogs({
        abi: gigaBridge.abi,
        eventName: 'LeafRegistered',
        logs: txReceipt.logs,
    })[0]
    return registerEvent.args.index
}

export function getGigaBridgeContractObj({address, publicClient, wallet}:{address:Address,publicClient:PublicClient, wallet:WalletClient}) {
    const gigaBridge = getContract({
        address:address,
        abi: gigaBridgeAbi,
        client: { public: publicClient, wallet }
    })
    return gigaBridge

}
