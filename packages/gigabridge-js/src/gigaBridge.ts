
import { IMT, IMTHashFunction, IMTNode } from "@zk-kit/imt"
// import { LeanIMT } from "@zk-kit/lean-imt"
import { poseidon2Hash } from "@zkpassport/poseidon2"
//import GigaBridgeArtifact from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"} 
import { IGigaBridge$Type } from "../../gigabridge-contracts/artifacts/contracts/gigabridge/interfaces/IGigaBridge.sol/artifacts.js"
import { Address, Client, getContract, PublicClient, WalletClient, GetContractReturnType, Transaction, Hash, parseEventLogs, ParseEventLogsReturnType, ParseEventLogsParameters, ExtractAbiItem, Abi, parseAbi, parseAbiItem, TransactionReceipt } from "viem";
//import {GigaBridgeContractWritableType } from "./types.js";
import { type GigaBridge$Type }  from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js"
import { GigaBridgeArtifact, GigaBridgeContractTestType } from "../../gigabridge-contracts/src/index.js";
import { GigaBridgeContractWithWalletClient, GigaBridgeContract, atLeastOneCLient } from "./types.js";
import { queryEventInChunks } from "./utils.js";

const GIGA_BRIDGE_DEPLOYMENT_BLOCKS: {[chainId: number]: bigint;} = {
    
}

// i hate typescript, this the one way to turn the fucking json thing into const and viem needs that otherwise it just forgets what function you can call on gigaBridge.write.
const gigaBridgeAbi = [...GigaBridgeArtifact.abi] as const; 

// TODO default address
const GIGA_BRIDGE_ADDRESS: Address = "0x0000000000000000000000000000000000000000"
const poseidon2IMTHashFunc:IMTHashFunction = (nodes:IMTNode[])=>poseidon2Hash(nodes as bigint[]) as IMTNode


function getGigaBridgeDeploymentBlock(chainId:number) {
    if (Number(chainId) in GIGA_BRIDGE_DEPLOYMENT_BLOCKS) {
        return GIGA_BRIDGE_DEPLOYMENT_BLOCKS[chainId]
    } else {
        console.warn(`no deployment block found for chainId: ${chainId.toString()}, defaulted to 0n`)
        return 0n
    }
}

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

export async function registerNewLeaf(
    {args ,gigaBridge, client:{publicClient, wallet}}
    :{
        args:[owner:Address,updater:Address,value:bigint],
        gigaBridge: GigaBridgeContractWithWalletClient|GigaBridgeContractTestType,
        client:{ publicClient:PublicClient, wallet:WalletClient} 
    }
){//:Promise<{index:bigint, txHash:Hash, txReceipt:TransactionReceipt}> {
    const txHash = await (gigaBridge as GigaBridgeContractWithWalletClient).write.registerNewLeaf(args, { account: wallet.account ?? null, chain: wallet.chain })
    const txReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
    const registerEvent = parseEventLogs({
        abi: gigaBridge.abi,
        eventName: 'LeafRegistered',
        logs: txReceipt.logs,
    })[0]
    return {index:registerEvent.args.index, txHash, txReceipt}
}

export async function updateLeaf({args ,gigaBridge, client:{publicClient, wallet}}:{args:[value:bigint, index:bigint],gigaBridge: GigaBridgeContractWithWalletClient|GigaBridgeContractTestType,client:{ publicClient:PublicClient, wallet:WalletClient} }):Promise<Hash> {
    const txHash = await (gigaBridge as GigaBridgeContractWithWalletClient).write.updateLeaf(args, { account: wallet.account ?? null, chain: wallet.chain })
    return txHash
}

export async function getGigaTree({gigaBridge, publicClient,deploymentBlock, blocksPerGetLogsReq}:{publicClient:PublicClient, gigaBridge: GigaBridgeContract|GigaBridgeContractTestType, deploymentBlock?:bigint, blocksPerGetLogsReq?:bigint}) {
    deploymentBlock ??= getGigaBridgeDeploymentBlock(await publicClient.getChainId())

    const removeDuplicateIndexes = (events: any[]) => {
        const knownIndexes = new Set<bigint>();
        return events.reverse().filter(item => {
            const index = item.args.index;
            if (knownIndexes.has(index)) {
                return false;
            }
            knownIndexes.add(index);
            return true;
        }).reverse()
    }
    const nextLeafIndex = await gigaBridge.read.nextGigaIndex()
    const depth = await gigaBridge.read.gigaDepth()
    // Can be further optimized by creating an event filter after each chunk that only scans for indexes that are already found
    // But idk if i should since maybe the amount of indexes can be too large?
    const events = await queryEventInChunks({
        publicClient:publicClient,
        contract:gigaBridge as GigaBridgeContract,
        eventName:"LeafUpdated",
        firstBlock:deploymentBlock,
        chunkSize:blocksPerGetLogsReq,
        reverseOrder: true,                        
        postQueryFilter: removeDuplicateIndexes,    // so maxEvents gets the correct length that doesn't include duplicates
        maxEvents: Number(nextLeafIndex)            // so it stops when all indexes are found
    })

    const sortedEvents = events.sort((a:any,b:any)=> Number(a.args.index - b.args.index) )
    const leafs = sortedEvents.map((event)=>event.args.value)
    const tree = new IMT(poseidon2IMTHashFunc, Number(depth), 0n, 2, leafs)
    return tree
}

export function getGigaBridgeContractObj({address, client}:{address:Address,client:Client}) {
    const gigaBridge = getContract({
        address:address,
        abi: gigaBridgeAbi,
        client:client
    })
    return gigaBridge
}
