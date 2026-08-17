
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
import { AnyContract, CachedTree, copyCachedTree, copyTree, TREE_TYPE, Trees } from "@warptoad/skinny-fat-imt-js";
import type { ReadonlyLeanIMT } from "@warptoad/skinny-fat-imt-js";
//import { queryEventInChunks } from "./viem-utils.js";


import { UnionOmit, WriteContractParameters } from "viem"

export type TxOpts = UnionOmit<
    WriteContractParameters<GigaBridge$Type["abi"], "updateLeaf">,
    "abi" | "address" | "functionName" | "args" | "account" | "chain"
>
export type ConnectedWalletClient = WalletClient & { account: Account }

const GIGA_BRIDGE_DEPLOYMENT_BLOCKS: { [chainId: number]: bigint; } = {

}

export type SyncTreeOpts = { syncToRoot?: bigint, attemptFastSizeMatch?: boolean, updatePin?: boolean, fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint }
// i hate typescript, this the one way to turn the fucking json thing into const and viem needs that otherwise it just forgets what function you can call on gigaBridge.write.
// the json import widens everything to string/never[], so borrow the literal abi tuple hardhat already generated in artifacts.d.ts
const gigaBridgeAbi = GigaBridgeArtifact.abi as unknown as GigaBridge$Type["abi"];

type GigaBridgeReadContract = GetContractReturnType<GigaBridge$Type["abi"], PublicClient, Address>;
type GigaBridgeWriteContract = GetContractReturnType<GigaBridge$Type["abi"], { public: PublicClient, wallet: WalletClient }, Address>;

// TODO default address
const GIGA_BRIDGE_ADDRESS: Address = "0x0000000000000000000000000000000000000000"
export const poseidon2IMTHashFunc: LeanIMTHashFunction = (a: bigint, b: bigint) => poseidon2Hash([a, b])

/**
 * `tree`, with `extra` hung off it. Object.create, *not* `{...tree}`: leaves/root/size/depth are getters
 * on LeanIMT.prototype and a spread only copies own properties (`_nodes`, `_hash`), so every one of them
 * comes back undefined. Going through the prototype keeps them working, and it hands out no copy: reads
 * land on `tree` itself. The return type is inferred rather than asserted, so a key you forgot to pass is
 * a type error instead of an undefined at runtime.
 */
function treeWith<E extends object>(tree: LeanIMT<bigint>, extra: E): ReadonlyLeanIMT & E {
    return Object.assign(Object.create(tree) as LeanIMT<bigint>, extra)
}

/** what every write comes back with */
export type TxResult = { txHash: Hex, txReceipt: TransactionReceipt }
/** a write that moved a tree, so it also reports where that tree ended up */
export type RootResult = TxResult & {
    root: bigint, treeSize: bigint,
    /** the tree as of `root`. Absent when the write was told to `skipSync`, since nothing built it */
    tree?: LeanIMT<bigint>
}
/** {@link GigaTreeWrite.insertLeaf} on top of that tells you which index it took */
export type RegisterLeafResult = RootResult & { index: bigint }

/** how a sync reads the chain. `fullNodeMode` off walks events, on reads storage */
export type SyncOpts = { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint }
/** a syncTree only ever exists in events, so there is no storage path to pick */
export type EventSyncOpts = { eventChunkSize?: bigint, storageChunkSize?: bigint }
/** `updatePin` moves the pin along with the sync instead of leaving it where it was */
export type GigaSyncOpts = SyncOpts & { updatePin?: boolean }

/**
 * What a gigaTree write may pass to the sync it runs once its tx has landed. `syncToRoot` and
 * `attemptFastSizeMatch` are the write's own to pick (it knows the root it just made, and whether it
 * inserted or updated), so they are omitted rather than offered.
 * @notice `"a" | "b"`, not `"a" & "b"`: two different string literals intersect to `never`, and
 * `Omit<T, never>` is `T`, so the `&` version omits nothing at all and silently offers both keys.
 */
export type WriteSyncOpts = Omit<SyncTreeOpts, "syncToRoot" | "attemptFastSizeMatch"> & {
    /** don't sync at all: the write costs one tx and comes back without a `tree` */
    skipSync?: boolean
}
/** same, minus `fullNodeMode`: a syncTree only ever exists in events, so there is no storage path */
export type EventWriteSyncOpts = Omit<WriteSyncOpts, "fullNodeMode">

/**
 * @notice every interface below is written in method syntax (`f(): T`) rather than as properties holding
 * function types (`f: () => T`). Both typecheck the same, but tsserver reports a property whose type is a
 * function as `property`, so the IDE gives it the variable icon and drops the doc comment. Method syntax
 * reports as `method`. The GigaBridge impls behind these are private and bound in, so this is the only
 * declaration a caller ever sees, and it has to be the one carrying the docs.
 */

/** the writes that land on the gigaTree. All of them need a connected wallet. */
export interface GigaTreeWrite {
    /**
     * Inserts a new leaf into the gigaTree and registers `owner` as its owner and `updater` as the only
     * address allowed to change it afterwards.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    insertLeaf(value: bigint, owner: Address, updater: Address, txOpts?: TxOpts, syncOpts?: WriteSyncOpts): Promise<RegisterLeafResult>
    /**
     * Overwrites the gigaTree leaf at `index`. The connected wallet must be its registered updater.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    updateLeaf(value: bigint, index: bigint, txOpts?: TxOpts, syncOpts?: WriteSyncOpts): Promise<RootResult>
    /**
     * Hands the right to update `index` to `newUpdater`. The connected wallet must be its owner.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    changeLeafUpdater(index: bigint, newUpdater: Address, txOpts?: TxOpts): Promise<TxResult>
    /**
     * Hands ownership of `index` to `newOwner`, who can then pick the updater. The connected wallet must
     * be its current owner.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    transferLeafOwner(index: bigint, newOwner: Address, txOpts?: TxOpts): Promise<TxResult>
}

/** the writes that build a syncTree. Needs a connected wallet. */
export interface SyncTreeWrite {
    /**
     * Builds a new syncTree out of leaves the gigaTree has held before, zero filling the gaps between the
     * indexes. Throws before it costs a tx if a value was never at its index. The tree is reset onchain at
     * the end of the same tx, so pin the root to see it: {@link SyncTreePinned.pinTx}.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    createNew(values: bigint[], indexes: bigint[], txOpts?: TxOpts, syncOpts?: EventWriteSyncOpts): Promise<RootResult>
}

/** hung off `gigaTree.cache` */
export interface GigaTreeCache {
    /** Syncs the gigaTree up to head and returns a copy of what it synced to. */
    sync(opts?: GigaSyncOpts): Promise<LeanIMT<bigint>>
}

/** hung off `gigaTree.pinned` */
export interface GigaTreePinned {
    /** Syncs the gigaTree up to head and moves the pin there. */
    sync(opts?: GigaSyncOpts): Promise<LeanIMT<bigint>>
    /** Rebuilds the gigaTree as it was at `gigaRoot` and pins it there. */
    pinRoot(gigaRoot: bigint, opts?: SyncOpts): Promise<LeanIMT>
    /** Same as {@link pinRoot}, but finds the root in the NewRoot events of `txHash`. */
    pinTx(txHash: Hex, opts?: SyncOpts): Promise<LeanIMT>
}

/** hung off `syncTree.pinned` */
export interface SyncTreePinned {
    /** Walks the events back to the syncTree that had `syncRoot` and pins it. */
    pinRoot(syncRoot: bigint, opts?: SyncOpts): Promise<LeanIMT>
    /** Same as {@link pinRoot}, but finds the root in the NewRoot events of `txHash`. */
    pinTx(txHash: Hex, opts?: EventSyncOpts): Promise<LeanIMT>
}

export class GigaBridge {
    private publicClient: PublicClient
    private walletClient?: ConnectedWalletClient;
    readonly address: Address;
    private contract?: GigaBridgeReadContract | GigaBridgeWriteContract;
    private trees: Trees;
    private hashFunction = poseidon2IMTHashFunc;
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
    /**
     * Until someone pins a root deliberately, `pinned` just follows whatever the last sync saw, so it is
     * never an empty tree next to a synced `cache`. @notice this can't be inferred from
     * `pinnedTrees.x.lastSynced === 0n`: every write syncs internally now, so the first one to run would
     * claim the pin and, having given it a real block number, freeze it there forever.
     */
    private pinFollowsHead = { gigaTree: true, syncTree: true };

    constructor(publicClient: PublicClient, walletClient?: ConnectedWalletClient, address = GIGA_BRIDGE_ADDRESS) {
        this.publicClient = publicClient;
        this.walletClient = walletClient
        this.address = address;
        this.trees = new Trees(this.address, this.publicClient, poseidon2IMTHashFunc)
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
            const [gigaId, syncId] = await Promise.all([this.contract.read.gigaTreeId(), this.contract.read.syncTreeId()])
            this.id = {
                gigaTree: toHex(gigaId),
                syncTree: toHex(syncId)
            }

            // @notice this.id, not getGigaTreeId()/getSyncTreeId(): those call back into init() and this
            // would recurse forever. Registering the trees is also a once-per-id thing, so it belongs in here
            const chainId = await this.publicClient.getChainId()
            const [gigaTree, syncTree] = await Promise.all([
                this.trees.initTree(this.id.gigaTree, chainId),
                this.trees.initTree(this.id.syncTree, chainId)
            ])
            if (this.pinnedTrees.gigaTree.lastSynced === 0n) {
                this.pinnedTrees.gigaTree = gigaTree
            }
            if (this.pinnedTrees.syncTree.lastSynced === 0n) {
                this.pinnedTrees.syncTree = syncTree
            }
        }
    }

    private async _getGigaTreeId(): Promise<Hex> {
        await this.init()
        return this.id!.gigaTree
    }

    private async _getSyncTreeId(): Promise<Hex> {
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
    private async _updateLeaf(value: bigint, index: bigint, txOpts: TxOpts = {}, { skipSync = false, ...syncOpts }: WriteSyncOpts = {}): Promise<RootResult> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.updateLeaf([value, index], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
        const newRootEvent = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: txReceipt.logs,
        })[0];
        // a bit of cheat since we shouldn't update the cache like this (Trees() should handle it)
        // but the Trees lib is horribly optimized for the scenario of syncToRoot + fullNodeMode, and this side steps it.
        // (this.trees.cache[this.id!.gigaTree].tree as LeanIMT<bigint>).update(Number(index), value)
        // we dont do this because tree might never be synced and then you cant update that leaf. Or it might fail and you have undo the update and sync again
        // too much code for micro optimization

        const tree = skipSync ? undefined : await this._syncGigaTree({ ...syncOpts, syncToRoot: newRootEvent.args.root, attemptFastSizeMatch: false })
        return {
            txHash, txReceipt,
            root: newRootEvent.args.root,
            treeSize: newRootEvent.args.size,
            tree: tree
        }
    }

    /**
     * Inserts new leaf into the GigaTree and registers it's index to be owned by the owner and allows updater to update the leaf. 
     * @param txOpts - the usual viem tx options (`WriteContractParameters`) (`gas`, `nonce`, …), minus `account`/`chain`
     * @returns {txHash, txReceipt, index, root, treeSize}
     */
    private async _registerNewLeaf(value: bigint, owner: Address, updater: Address, txOpts: TxOpts = {}, { skipSync = false, ...syncOpts }: WriteSyncOpts = {}): Promise<RegisterLeafResult> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.registerNewLeaf([value, owner, updater], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
        const newRootEvent = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: txReceipt.logs,
        })[0];
        const newLeafEvent = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewLeaf',
            logs: txReceipt.logs,
        })[0];
        // attemptFastSizeMatch: true, usually wont work, but in this case it work 99% of the time (not if some update lands in  same block as registerNewLeaf)
        // @notice syncOpts spreads FIRST, see _updateLeaf
        const tree = skipSync ? undefined : await this._syncGigaTree({ ...syncOpts, syncToRoot: newRootEvent.args.root, attemptFastSizeMatch: true })

        // TODO do the little return multiple promises trick like here: https://github.com/jimjimvalkema/zktranswarp/blob/a0a642d5a7018050b61fa213780e32403b926f6f/src/BurnWallet.ts#L406-L422
        // so caller can do const {txHash, tree} = gigaBridge._createNewSyncTree()
        // then not have to wait on the tree to sync or txReceipt, so they can show the pending tx in ui
        // do same else where a tx is made
        return {
            txHash, txReceipt,
            root: newRootEvent.args.root,
            treeSize: newRootEvent.args.size,
            tree: tree,
            index: newLeafEvent.args.index
        }
    }

    /**
     * Creates a new syncTree. The connected wallet must be its registered updater.
     * @param txOpts - the usual viem tx options (`WriteContractParameters`) (`gas`, `nonce`, …), minus `account`/`chain`
     * @returns {txHash, txReceipt, root, treeSize}
     */
    private async _createNewSyncTree(values: bigint[], indexes: bigint[], txOpts: TxOpts = {}, { skipSync = false, ...syncOpts }: EventWriteSyncOpts = {}): Promise<RootResult> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')

        // catch caller mistake early if the provide a leaf that has not existed
        // TODO one eth_call per leaf. Batch it into a single multicall, the contract require()s this
        // anyway so the only thing these reads buy is the better error message below
        const areValid = await Promise.all(values.map((value, i) => this.contract!.read.leafHistory([indexes[i], value])))
        let invalidLeafs: string[] = []
        for (let index = 0; index < areValid.length; index++) {
            if (areValid[index] === false) {
                invalidLeafs.push(`leaf=${toHex(values[index], { size: 32 })} at index=${Number(indexes[index])}\n`)
            }
        }
        if (invalidLeafs.length > 0) { throw new Error(`Some leaf are never found in leaf history: \n ${invalidLeafs}`) }

        // make the tx
        const txHash = await this.contract!.write.createNewSyncTree([values, indexes], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
        const newRootEvents = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: txReceipt.logs,
        }).filter((newRoot) => newRoot.args.size !== 0n) // filter out reset
        // when there are gaps, you have multiple insert/insertMany/insertManyRepeated calls, emit-ing NewRoot Events
        const newRootEvent = newRootEvents[newRootEvents.length - 1]
        // @notice syncOpts spreads FIRST, see _updateLeaf
        const tree = skipSync ? undefined : await this._syncSyncTree({ ...syncOpts, syncToRoot: newRootEvent.args.root })
        return {
            txHash, txReceipt,
            root: newRootEvent.args.root,
            treeSize: newRootEvent.args.size,
            tree: tree
        }
    }

    private async _transferOwnerOfLeafIndex(index: bigint, newOwner: Address, txOpts: TxOpts = {}): Promise<TxResult> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.transferOwnerOfLeafIndex([index, newOwner], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
        return {
            txHash, txReceipt,
        }
    }

    private async _setUpdaterOfLeafIndex(index: bigint, newUpdater: Address, txOpts: TxOpts = {}): Promise<TxResult> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.setUpdaterOfLeafIndex([index, newUpdater], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
        return {
            txHash, txReceipt,
        }
    }

    // {fullNodeMode, blockNumber, attemptFastSizeMatch, syncToRoot, eventChunkSize, storageChunkSize, hasRepeatedLeafs, insertOnlyTree, autoDiscovery}:{ fullNodeMode?: boolean, blockNumber?: bigint, attemptFastSizeMatch?: boolean, syncToRoot?: bigint, eventChunkSize?: bigint, storageChunkSize?: bigint, hasRepeatedLeafs?: boolean, insertOnlyTree?: boolean, autoDiscovery?: boolean | undefined } = {}
    private async _syncGigaTree({ attemptFastSizeMatch = false, syncToRoot, updatePin = false, fullNodeMode = true, eventChunkSize, storageChunkSize }: SyncTreeOpts = {}) {
        await this.init()
        const gigaTree = (await this.trees.sync([BigInt(await this._getGigaTreeId())], {
            // settings
            fullNodeMode, eventChunkSize, storageChunkSize, syncToRoot,
            // default
            attemptFastSizeMatch: attemptFastSizeMatch, // rarely works since leafs update so often 
            hasRepeatedLeafs: false,    // gigaTree does not have that, this saves a bit on event scan
            insertOnlyTree: false,
            autoDiscovery: false
        }))[await this._getGigaTreeId()]

        const pinTookIt = updatePin || this.pinFollowsHead.gigaTree
        if (pinTookIt) {
            this.pinnedTrees.gigaTree = gigaTree
        }
        // trees.sync already hands back a copyCachedTree that nothing else holds, so this only needs
        // copying again when the pin just took that one
        return pinTookIt ? copyTree(gigaTree.tree, this.hashFunction) : gigaTree.tree
    }

    private async _syncPinnedGigaTree({pinFollowsHead=true, syncToRoot, fullNodeMode = true, eventChunkSize, storageChunkSize }: {pinFollowsHead?:boolean, syncToRoot?: bigint, updatePin?: boolean, fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        // moving the pin on purpose, same as _pinGigaRoot, so it stops trailing every sync from here on
        this.pinFollowsHead.gigaTree = pinFollowsHead
        return await this._syncGigaTree({ syncToRoot, updatePin: true, fullNodeMode, eventChunkSize, storageChunkSize, attemptFastSizeMatch: false })
    }

    private async _syncSyncTree({ syncToRoot, updatePin = false, eventChunkSize, storageChunkSize }: SyncTreeOpts = {}) {
        await this.init()
        const syncTree = (await this.trees.sync([BigInt(await this._getSyncTreeId())], {
            // settings
            eventChunkSize, storageChunkSize, syncToRoot,
            // default
            fullNodeMode: false,            // cant use this, syncTree uses the event variant
            attemptFastSizeMatch: false, // does not do anything since tree resets every tx 
            hasRepeatedLeafs: true,    // SyncTree uses these
            insertOnlyTree: false,
            autoDiscovery: false
        }))[await this._getSyncTreeId()]

        const pinTookIt = updatePin || this.pinFollowsHead.syncTree
        if (pinTookIt) {
            this.pinnedTrees.syncTree = syncTree
        }
        // see _syncGigaTree: only copy when the pin took the one trees.sync gave us
        return pinTookIt ? copyTree(syncTree.tree, this.hashFunction) : syncTree.tree
    }

    // would pinning to block number ever need to exist?
    private async _pinGigaRoot(gigaRoot: bigint, { fullNodeMode = true, eventChunkSize, storageChunkSize }: { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        await this.init()
        // a deliberate pin, so stop dragging it along with every sync from here on
        this.pinFollowsHead.gigaTree = false
        const pin = await this._syncGigaTree({ syncToRoot: gigaRoot, updatePin: true, fullNodeMode, eventChunkSize, storageChunkSize, attemptFastSizeMatch: false })
        return pin
    }

    private async _pinSyncRoot(syncRoot: bigint, { eventChunkSize, storageChunkSize }: { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        await this.init()
        // a deliberate pin, so stop dragging it along with every sync from here on
        this.pinFollowsHead.syncTree = false
        const pin = await this._syncSyncTree({ updatePin: true, syncToRoot: syncRoot, eventChunkSize, storageChunkSize })
        return pin
    }

    private async _pinGigaRootTx(txHash: Hex, { fullNodeMode, eventChunkSize, storageChunkSize }: { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        const [gigaTreeId, receipt] = await Promise.all([
            this._getGigaTreeId(),
            this.publicClient.waitForTransactionReceipt({ hash: txHash })
        ])
        const newRootEvents = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: receipt.logs,
        }).filter((event) => event.args.treeId === BigInt(gigaTreeId) && event.args.size > 0n)
        if (newRootEvents.length === 0) throw new Error(`no NewRoot events found that contains a GigaRoot in tx: ${txHash}.`)
        const syncRoot = newRootEvents[newRootEvents.length - 1].args.root
        return await this._pinGigaRoot(syncRoot, { fullNodeMode, eventChunkSize, storageChunkSize })
    }

    private async _pinSyncRootTx(txHash: Hex, { eventChunkSize, storageChunkSize }: { eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        const [syncTreeId, receipt] = await Promise.all([
            this._getSyncTreeId(),
            this.publicClient.waitForTransactionReceipt({ hash: txHash })
        ])
        const newRootEvents = parseEventLogs({
            abi: gigaBridgeAbi,
            eventName: 'NewRoot',
            logs: receipt.logs,
        }).filter((event) => event.args.treeId === BigInt(syncTreeId) && event.args.size > 0n)
        if (newRootEvents.length === 0) throw new Error(`no NewRoot events found that contains a SyncRoot in tx: ${txHash}.`)
        const syncRoot = newRootEvents[newRootEvents.length - 1].args.root
        return await this._pinSyncRoot(syncRoot, { eventChunkSize, storageChunkSize })
    }

    get gigaTree() {
        const self = this
        const notInitialized = this.id === undefined
        if (notInitialized) console.warn('gigaTree is not initialized yet, returning an empty gigaTree. init(), sync() or any write does it')
        // bound, otherwise `const {pinRoot} = gigaBridge.gigaTree` (or just calling it off the returned
        // object) loses `this` and every `this.init()` inside them throws.
        // annotated, otherwise the inferred type makes each of these a property holding a function and the
        // IDE stops calling them methods. Also the line that catches a private impl drifting from its docs
        // TODO anything that changes the tree onchain should also return you a up to date tree and update the cache (idk about re-orgs tho so maybe not update cache if it takes too long?)
        const write: GigaTreeWrite = {
            insertLeaf: this._registerNewLeaf.bind(this),
            updateLeaf: this._updateLeaf.bind(this),
            changeLeafUpdater: this._setUpdaterOfLeafIndex.bind(this),
            transferLeafOwner: this._transferOwnerOfLeafIndex.bind(this)
        }
        // getters, not values: reading one tree shouldn't build the other, and reaching a function off
        // here shouldn't touch a tree at all
        return {
            /**
             * The head this instance last synced to, live: it is the lib's own cached tree, and the event
             * sync merges new leaves into it in place, so it can move under you between two reads. Meant
             * for inspecting how far the sync got. For a tree that stays put, use {@link pinned}, and to
             * modify one, `copyTree` it first, the type here allows no writes.
             */
            get cache() {
                const tree = notInitialized
                    ? new LeanIMT(self.hashFunction, [])
                    : self.trees.cache[self.id!.gigaTree].tree as LeanIMT<bigint>
                return treeWith<GigaTreeCache>(tree, { sync: self._syncGigaTree.bind(self) })
            },

            /**
             * The tree as of the pinned root. Nothing else holds this one and pinning replaces it rather
             * than growing it, so what you get here keeps its root even after the pin moves on.
             */
            get pinned() {
                const tree = notInitialized ? new LeanIMT(self.hashFunction, []) : self.pinnedTrees.gigaTree.tree
                return treeWith<GigaTreePinned>(tree, {
                    sync: self._syncPinnedGigaTree.bind(self),
                    pinRoot: self._pinGigaRoot.bind(self),
                    pinTx: self._pinGigaRootTx.bind(self),
                })
            },
            get lastSync(): bigint {
                return notInitialized ? 0n : self.trees.cache[self.id!.gigaTree].lastSynced
            },
            get write() {
                return write
            },
            get id(): Hex {
                if (notInitialized) {
                    throw new Error('GigaBridge object is not initialized, please do `await gigaBridge.init*()`')
                } else {
                    return self.id!.gigaTree
                }
            }
        }
    }

    get syncTree() {
        const self = this
        const notInitialized = this.id === undefined
        if (notInitialized) console.warn('syncTree is not initialized yet, returning an empty syncTree. init(), sync() or any write does it')
        // see gigaTree.write for why this is annotated
        const transact: SyncTreeWrite = {
            createNew: this._createNewSyncTree.bind(this),
        }
        // see gigaTree for why neither of these is a copy
        return {
            /** live, see gigaTree.cache. The syncTree resets every tx, so onchain this is near always empty */
            get cache(): ReadonlyLeanIMT {
                if (notInitialized) return new LeanIMT(self.hashFunction, [])
                return self.trees.cache[self.id!.syncTree].tree as ReadonlyLeanIMT
            },
            /** the tree as of the pinned syncRoot, the only way to see a syncTree that isn't reset */
            get pinned() {
                const tree = notInitialized ? new LeanIMT(self.hashFunction, []) : self.pinnedTrees.syncTree.tree
                return treeWith<SyncTreePinned>(tree, {
                    pinRoot: self._pinSyncRoot.bind(self),
                    pinTx: self._pinSyncRootTx.bind(self)
                })
            },
            get lastSync(): bigint {
                return notInitialized ? 0n : self.trees.cache[self.id!.syncTree].lastSynced
            },
            get write() {
                return transact
            },
            get id(): Hex {
                if (notInitialized) {
                    throw new Error('GigaBridge object is not initialized, please do `await gigaBridge.init*()`')
                } else {
                    return self.id!.syncTree
                }
            }
        }
    }

}
