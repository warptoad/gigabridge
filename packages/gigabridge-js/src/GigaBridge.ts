
import { IMTHashFunction, IMTNode } from "@zk-kit/imt"
import { LeanIMT, LeanIMTHashFunction } from "@zk-kit/lean-imt"
import { poseidon2Hash } from "@zkpassport/poseidon2"
//import GigaBridgeArtifact from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"} 
import { IGigaBridge$Type } from "../../gigabridge-contracts/artifacts/contracts/gigabridge/interfaces/IGigaBridge.sol/artifacts.js"
import { Address, Client, getContract, PublicClient, WalletClient, GetContractReturnType, Transaction, Hash, parseEventLogs, ParseEventLogsReturnType, ParseEventLogsParameters, ExtractAbiItem, Abi, parseAbi, parseAbiItem, TransactionReceipt, Hex, Chain, toHex, Account } from "viem";
//import {GigaBridgeContractWritableType } from "./types.js";
import { type GigaBridge$Type } from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js"
import { GigaBridgeArtifact, GigaBridgeContractTestType } from "../../gigabridge-contracts/src/index.js";
import { GigaBridgeContractWithWalletClient, GigaBridgeContract, atLeastOneCLient } from "./types.js";
import { AnyContract, CachedTree, copyTree, TREE_TYPE, Trees } from "@warptoad/skinny-fat-imt-js";
import type { ReadonlyLeanIMT } from "@warptoad/skinny-fat-imt-js";
//import { queryEventInChunks } from "./viem-utils.js";


import { UnionOmit, WriteContractParameters } from "viem"

type TxOpts = UnionOmit<
    WriteContractParameters<GigaBridge$Type["abi"], "updateLeaf">,
    "abi" | "address" | "functionName" | "args" | "account" | "chain"
>
export type ConnectedWalletClient = WalletClient & { account: Account }

export async function registerNewLeaf(
    { args, gigaBridge, client: { publicClient, wallet } }
        : {
            args: [value: bigint, owner: Address, updater: Address],
            gigaBridge: GigaBridgeContractWithWalletClient | GigaBridgeContractTestType,
            client: { publicClient: PublicClient, wallet: WalletClient }
        }
) {//:Promise<{index:bigint, txHash:Hash, txReceipt:TransactionReceipt}> {
    const txHash = await (gigaBridge as GigaBridgeContractWithWalletClient).write.registerNewLeaf(args, { account: wallet.account ?? null, chain: wallet.chain })
    const txReceipt = await publicClient.getTransactionReceipt({ hash: txHash });
    const registerEvent = parseEventLogs({
        abi: gigaBridge.abi,
        eventName: 'LeafRegistered',
        logs: txReceipt.logs,
    })[0]
    return { index: registerEvent.args.index, txHash, txReceipt }
}

export async function updateLeaf({ args, gigaBridge, client: { publicClient, wallet } }: { args: [value: bigint, index: bigint], gigaBridge: GigaBridgeContractWithWalletClient | GigaBridgeContractTestType, client: { publicClient: PublicClient, wallet: WalletClient } }): Promise<Hash> {
    const txHash = await (gigaBridge as GigaBridgeContractWithWalletClient).write.updateLeaf(args, { account: wallet.account ?? null, chain: wallet.chain })
    return txHash
}

const GIGA_BRIDGE_DEPLOYMENT_BLOCKS: { [chainId: number]: bigint; } = {

}

// i hate typescript, this the one way to turn the fucking json thing into const and viem needs that otherwise it just forgets what function you can call on gigaBridge.write.
// the json import widens everything to string/never[], so borrow the literal abi tuple hardhat already generated in artifacts.d.ts
const gigaBridgeAbi = GigaBridgeArtifact.abi as unknown as GigaBridge$Type["abi"];

type GigaBridgeReadContract = GetContractReturnType<GigaBridge$Type["abi"], PublicClient, Address>;
type GigaBridgeWriteContract = GetContractReturnType<GigaBridge$Type["abi"], { public: PublicClient, wallet: WalletClient }, Address>;

// TODO default address
const GIGA_BRIDGE_ADDRESS: Address = "0x0000000000000000000000000000000000000000"
export const poseidon2IMTHashFunc: LeanIMTHashFunction = (a: bigint, b: bigint) => poseidon2Hash([a, b])

export class GigaBridge {
    private publicClient: PublicClient
    private walletClient?: ConnectedWalletClient;
    readonly address: Address;
    private contract?: GigaBridgeReadContract | GigaBridgeWriteContract;
    private trees?: Trees;
    readonly hashFunction = poseidon2IMTHashFunc;
    private pinnedTrees = {
        gigaTree: {
            tree: new LeanIMT(this.hashFunction, []),
            type: TREE_TYPE.FAT_STORAGE,
            lastSynced: 0n,
            insertOnlyTree: false
        } as CachedTree,
        syncTree: {
            tree: new LeanIMT(this.hashFunction, []),
            type: TREE_TYPE.SKINNY_EVENT,
            lastSynced: 0n,
            insertOnlyTree: true,

        } as CachedTree
    };
    private id?: { gigaTree: Hex, syncTree: Hex };

    constructor(publicClient: PublicClient, address = GIGA_BRIDGE_ADDRESS, walletClient: ConnectedWalletClient) {
        this.publicClient = publicClient;
        this.walletClient = walletClient
        this.address = address;
    }

    async init() {
        // right side of `or` is "if wallet got connected after class got constructed"
        if (this.contract === undefined || (this.contract.write === undefined && this.walletClient !== undefined)) {
            this.contract = getContract({
                abi: gigaBridgeAbi, address: this.address,
                client: { public: this.publicClient, wallet: this.walletClient as WalletClient }
            })
        }
        if (this.id === undefined) {
            const [gigaId, syncId] = await Promise.all([await this.contract.read.gigaTreeId(), await this.contract.read.syncTreeId()])
            this.id = {
                gigaTree: toHex(gigaId),
                syncTree: toHex(syncId)
            }
        }
    }

    async getGigaTreeId(): Promise<Hex> {
        await this.init()
        return this.id!.gigaTree
    }

    async getSyncTreeId(): Promise<Hex> {
        await this.init()
        return this.id!.syncTree
    }

    connectWallet(wallet: ConnectedWalletClient) {
        this.walletClient = wallet
    }

    /**
     * Overwrites the gigaTree leaf at `index`. The connected wallet must be its registered updater.
     * @param txOpts - the usual viem tx options (`WriteContractParameters`) (`gas`, `nonce`, …), minus `account`/`chain`
     * @returns {txHash, txReceipt, root, treeSize}
     */
    async updateLeaf(value: bigint, index: bigint, txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt, root: bigint, treeSize: bigint }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.updateLeaf([value, index], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.getTransactionReceipt({ hash: txHash })
        const newRootEvent = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: txReceipt.logs,
        })[0]
        return {
            txHash, txReceipt,
            root: newRootEvent.args.root,
            treeSize: newRootEvent.args.size,
        }
    }

    /**
     * Inserts new leaf into the GigaTree and registers it's index to be owned by the owner and allows updater to update the leaf. 
     * @param txOpts - the usual viem tx options (`WriteContractParameters`) (`gas`, `nonce`, …), minus `account`/`chain`
     * @returns {txHash, txReceipt, index, root, treeSize}
     */
    async registerNewLeaf(value: bigint, owner: Address, updater: Address, txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt, index: bigint, root: bigint, treeSize: bigint }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.registerNewLeaf([value, owner, updater], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.getTransactionReceipt({ hash: txHash })
        const newRootEvent = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: txReceipt.logs,
        })[0]
        const newLeafEvent = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewLeaf',
            logs: txReceipt.logs,
        })[0]
        return {
            txHash, txReceipt,
            root: newRootEvent.args.root,
            treeSize: newRootEvent.args.size,
            index: newLeafEvent.args.index
        }
    }

    /**
     * Creates a new syncTree. The connected wallet must be its registered updater.
     * @param txOpts - the usual viem tx options (`WriteContractParameters`) (`gas`, `nonce`, …), minus `account`/`chain`
     * @returns {txHash, txReceipt, root, treeSize}
     */
    async createNewSyncTree(values: bigint[], indexes: bigint[], txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt, root: bigint, treeSize: bigint }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        
        // catch caller mistake early if the provide a leaf that has not existed
        const areValid = await Promise.all(values.map((value, i) => this.contract!.read.leafHistory([indexes[i], value])))
        let invalidLeafs:string[] = []
        for (let index = 0; index < areValid.length; index++) {
            if(areValid[index] === false) {
                invalidLeafs.push(`leaf=${toHex(values[index], {size:32})} at index=${toHex(indexes[index], {size:32})}\n`)
            }
        }
        if(invalidLeafs.length > 0) {throw new Error(`Some leaf are never found in leaf history: \n ${invalidLeafs}`)}
        
        // make the tx
        const txHash = await this.contract!.write.createNewSyncTree([values, indexes], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.getTransactionReceipt({ hash: txHash })
        const newRootEvents = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: txReceipt.logs,
        })
        // when there are gaps, you have multiple insert/insertMany/insertManyRepeated calls, emit-ing NewRoot Events
        const newRootEvent = newRootEvents[newRootEvents.length - 1]
        return {
            txHash, txReceipt,
            root: newRootEvent.args.root,
            treeSize: newRootEvent.args.size,
        }
    }

    async transferOwnerOfLeafIndex(index: bigint, newOwner: Address, txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.transferOwnerOfLeafIndex([index, newOwner], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.getTransactionReceipt({ hash: txHash })
        return {
            txHash, txReceipt,
        }
    }

    async setUpdaterOfLeafIndex(index: bigint, newUpdater: Address, txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.setUpdaterOfLeafIndex([index, newUpdater], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.getTransactionReceipt({ hash: txHash })
        return {
            txHash, txReceipt,
        }
    }

    // {fullNodeMode, blockNumber, attemptFastSizeMatch, syncToRoot, eventChunkSize, storageChunkSize, hasRepeatedLeafs, insertOnlyTree, autoDiscovery}:{ fullNodeMode?: boolean, blockNumber?: bigint, attemptFastSizeMatch?: boolean, syncToRoot?: bigint, eventChunkSize?: bigint, storageChunkSize?: bigint, hasRepeatedLeafs?: boolean, insertOnlyTree?: boolean, autoDiscovery?: boolean | undefined } = {}
    async sync({ fullNodeMode, eventChunkSize, storageChunkSize }: { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        await this.init()
        if (this.trees === undefined) {
            this.trees = new Trees(this.address, this.publicClient, poseidon2IMTHashFunc)
            const syncTree = await this.trees.initTree(await this.getSyncTreeId(), await this.publicClient.getChainId())
            // initial sync (not sync tree, it resets every tx so not use full to sync like this)
            const gigaTree = (await this.trees.sync([BigInt(await this.getGigaTreeId())], {
                // settings
                fullNodeMode, eventChunkSize, storageChunkSize,
                // default
                attemptFastSizeMatch: false, // rarely works since leafs update so often 
                syncToRoot: undefined,
                hasRepeatedLeafs: false,    // gigaTree does not have that, this saves a bit on event scan
                insertOnlyTree: false,
                autoDiscovery: false
            }))[await this.getGigaTreeId()]

            if (this.pinnedTrees?.gigaTree.lastSynced === 0n) {
                this.pinnedTrees.gigaTree = gigaTree
            }
            if (this.pinnedTrees?.syncTree.lastSynced === 0n) {
                this.pinnedTrees.syncTree = syncTree
            }
        }
    }

    // would pinning to block number ever need to exist?
    async pinGigaRoot(gigaRoot: bigint, { fullNodeMode, eventChunkSize, storageChunkSize }: { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        await this.init()
        const pin = (await this.trees!.sync([BigInt(await this.getGigaTreeId())], {
            // inputs
            syncToRoot: gigaRoot,
            // settings
            fullNodeMode, eventChunkSize, storageChunkSize,
            // default
            attemptFastSizeMatch: false, // rarely works since leafs update so often 
            hasRepeatedLeafs: false,    // gigaTree does not have that, this saves a bit on event scan
            insertOnlyTree: false,
            autoDiscovery: false
        }))[await this.getGigaTreeId()]
        this.pinnedTrees!.gigaTree = pin
        return pin
    }

    async pinSyncRoot(syncRoot: bigint, { eventChunkSize, storageChunkSize }: { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        await this.init()
        const pin = (await this.trees!.sync([BigInt(await this.getSyncTreeId())], {
            // inputs
            syncToRoot: syncRoot,
            // settings
            eventChunkSize, storageChunkSize,
            // default
            fullNodeMode: false,
            attemptFastSizeMatch: false, // rarely works since leafs update so often 
            hasRepeatedLeafs: false,    // gigaTree does not have that, this saves a bit on event scan
            insertOnlyTree: false,
            autoDiscovery: false
        }))[await this.getGigaTreeId()]
        this.pinnedTrees!.syncTree = pin
        return pin
    }

    async pinGigaRootTx(txHash: Hex, { fullNodeMode, eventChunkSize, storageChunkSize }: { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        const [gigaTreeId, receipt] = await Promise.all([
            this.getGigaTreeId(),
            this.publicClient.getTransactionReceipt({ hash: txHash })
        ])
        const newRootEvents = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: receipt.logs,
        }).filter((event) => event.args.treeId === BigInt(gigaTreeId) && event.args.size > 0n)
        if (newRootEvents.length === 0) throw new Error(`no NewRoot events found that contains a GigaRoot in tx: ${txHash}.`)
        const syncRoot = newRootEvents[newRootEvents.length - 1].args.root
        return await this.pinGigaRoot(syncRoot, { fullNodeMode, eventChunkSize, storageChunkSize })
    }

    async pinSyncRootTx(txHash: Hex, { eventChunkSize, storageChunkSize }: { eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        const [syncTreeId, receipt] = await Promise.all([
            this.getSyncTreeId(),
            this.publicClient.getTransactionReceipt({ hash: txHash })
        ])
        const newRootEvents = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: receipt.logs,
        }).filter((event) => event.args.treeId === BigInt(syncTreeId) && event.args.size > 0n)
        if (newRootEvents.length === 0) throw new Error(`no NewRoot events found that contains a SyncRoot in tx: ${txHash}.`)
        const syncRoot = newRootEvents[newRootEvents.length - 1].args.root
        return await this.pinSyncRoot(syncRoot, { eventChunkSize, storageChunkSize })
    }

    get gigaTree() {
        const notInitialized = this.id === undefined
        const neverSynced = this.trees === undefined
        if (notInitialized || neverSynced) {
            if (notInitialized) console.warn('GigaTree is never synced. returning empty gigaTree')
            if (neverSynced) console.warn('GigaTree is never synced. returning empty gigaTree')
            return {
                cache: new LeanIMT(this.hashFunction, []) as ReadonlyLeanIMT,
                ...new LeanIMT(this.hashFunction, []) as ReadonlyLeanIMT,
                lastSync: 0n,
                pinRoot: this.pinGigaRoot,
                pinTx: this.pinGigaRootTx
            }
        } else {
            return {
                cache: copyTree(this.trees!.cache[this.id!.gigaTree].tree as LeanIMT<bigint>, this.hashFunction) as ReadonlyLeanIMT,
                ...copyTree(this.pinnedTrees!.gigaTree.tree, this.hashFunction) as ReadonlyLeanIMT,
                lastSync: this.trees!.cache[this.id!.gigaTree].lastSynced,
                pinRoot: this.pinGigaRoot,
                pinTx: this.pinGigaRootTx
            }
        }
    }

    get syncTree() {
        const notInitialized = this.id === undefined
        const neverSynced = this.trees === undefined
        if (notInitialized || neverSynced) {
            if (notInitialized) console.warn('GigaTree is never synced. returning empty syncTree')
            if (neverSynced) console.warn('GigaTree is never synced. returning empty syncTree')
            return {
                cache: new LeanIMT(this.hashFunction, []),
                ...new LeanIMT(this.hashFunction, []),
                lastSync: 0n,
                pinRoot: this.pinSyncRoot,
                pinTx: this.pinSyncRootTx
            }
        } else {
            return {
                // it's already readonly so why copy?
                cache: copyTree(this.trees!.cache[this.id!.syncTree].tree as LeanIMT<bigint>, this.hashFunction) as ReadonlyLeanIMT,
                // would deconstructing break ReadonlyLeanIMT?
                ...copyTree(this.pinnedTrees!.syncTree.tree, this.hashFunction) as ReadonlyLeanIMT,
                lastSync: this.trees!.cache[this.id!.syncTree].lastSynced,
                pinRoot: this.pinSyncRoot,
                pinTx: this.pinSyncRootTx
            }
        }
    }

}
