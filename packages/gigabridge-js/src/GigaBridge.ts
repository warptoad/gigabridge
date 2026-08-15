
import { IMTHashFunction, IMTNode } from "@zk-kit/imt"
import { LeanIMT, LeanIMTHashFunction } from "@zk-kit/lean-imt"
import { poseidon2Hash } from "@zkpassport/poseidon2"
//import GigaBridgeArtifact from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"} 
import { IGigaBridge$Type } from "../../gigabridge-contracts/artifacts/contracts/gigabridge/interfaces/IGigaBridge.sol/artifacts.js"
import { Address, Client, getContract, PublicClient, WalletClient, GetContractReturnType, Transaction, Hash, parseEventLogs, ParseEventLogsReturnType, ParseEventLogsParameters, ExtractAbiItem, Abi, parseAbi, parseAbiItem, TransactionReceipt, Hex, Chain, toHex } from "viem";
//import {GigaBridgeContractWritableType } from "./types.js";
import { type GigaBridge$Type } from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js"
import { GigaBridgeArtifact, GigaBridgeContractTestType } from "../../gigabridge-contracts/src/index.js";
import { GigaBridgeContractWithWalletClient, GigaBridgeContract, atLeastOneCLient } from "./types.js";
import { AnyContract, CachedTree, Trees } from "@warptoad/skinny-fat-imt-js";
//import { queryEventInChunks } from "./viem-utils.js";

const GIGA_BRIDGE_DEPLOYMENT_BLOCKS: { [chainId: number]: bigint; } = {

}

// i hate typescript, this the one way to turn the fucking json thing into const and viem needs that otherwise it just forgets what function you can call on gigaBridge.write.
// the json import widens everything to string/never[], so borrow the literal abi tuple hardhat already generated in artifacts.d.ts
const gigaBridgeAbi = GigaBridgeArtifact.abi as unknown as GigaBridge$Type["abi"];

type GigaBridgeReadContract = GetContractReturnType<GigaBridge$Type["abi"], PublicClient, Address>;

// TODO default address
const GIGA_BRIDGE_ADDRESS: Address = "0x0000000000000000000000000000000000000000"
export const poseidon2IMTHashFunc: LeanIMTHashFunction = (a: bigint, b: bigint) => poseidon2Hash([a, b])


export class GigaBridge {
    publicClient: PublicClient
    address: Address;
    contract?: GigaBridgeReadContract;
    trees?: Trees;
    id?: { gigaTree: Hex, syncTree: Hex };
    constructor(publicClient: PublicClient, address = GIGA_BRIDGE_ADDRESS) {
        this.publicClient = publicClient;
        this.address = address;
    }

    // {fullNodeMode, blockNumber, attemptFastSizeMatch, syncToRoot, eventChunkSize, storageChunkSize, hasRepeatedLeafs, insertOnlyTree, autoDiscovery}:{ fullNodeMode?: boolean, blockNumber?: bigint, attemptFastSizeMatch?: boolean, syncToRoot?: bigint, eventChunkSize?: bigint, storageChunkSize?: bigint, hasRepeatedLeafs?: boolean, insertOnlyTree?: boolean, autoDiscovery?: boolean | undefined } = {}
    async init({fullNodeMode, eventChunkSize, storageChunkSize}:{ fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        if (this.contract === undefined) {
            this.contract = getContract({ abi: gigaBridgeAbi, address: this.address, client: this.publicClient })
        }
        if (this.id === undefined) {
            const [gigaId, syncId] = await Promise.all([await this.contract.read.gigaTreeId(), await this.contract.read.syncTreeId()])
            this.id = {
                gigaTree: toHex(gigaId),
                syncTree: toHex(syncId)
            }
        }
        if (this.trees === undefined) {
            this.trees = new Trees(this.address, this.publicClient, poseidon2IMTHashFunc)
            // initial sync
            await this.trees.sync([BigInt(this.id.gigaTree), BigInt(this.id.syncTree)], {
                // settings
                fullNodeMode, eventChunkSize, storageChunkSize,
                // default
                attemptFastSizeMatch: true,
                syncToRoot: undefined,
                hasRepeatedLeafs: true, 
                insertOnlyTree: false,
                autoDiscovery: false
            })
        }
    }


    // get gigaTree() {
    //     return {
    //         this.tr
    //     }
    // }
}
