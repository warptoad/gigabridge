
import { IMTHashFunction, IMTNode } from "@zk-kit/imt"
import { LeanIMT, LeanIMTHashFunction } from "@zk-kit/lean-imt"
import { poseidon2Hash } from "@zkpassport/poseidon2"
//import GigaBridgeArtifact from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"} 
import { IGigaBridge$Type } from "../../gigabridge-contracts/artifacts/contracts/gigabridge/interfaces/IGigaBridge.sol/artifacts.js"
import { Address, Client, getContract, PublicClient, WalletClient, GetContractReturnType, Transaction, Hash, parseEventLogs, ParseEventLogsReturnType, ParseEventLogsParameters, ExtractAbiItem, Abi, parseAbi, parseAbiItem, TransactionReceipt, Hex, Chain, toHex, Account } from "viem";
//import {GigaBridgeContractWritableType } from "./types.js";
import { type GigaBridge$Type } from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js"
import { GigaBridgeArtifact, GigaBridgeContractTestType } from "../../gigabridge-contracts/src/index.js";
import { GigaBridgeContractWithWalletClient, GigaBridgeContract, atLeastOneCLient, ConnectedWalletClient, GigaBridgeReadContract, GigaBridgeWriteContract, ViemTxOpts, WriteSyncOpts, RootResult, RegisterLeafResult, EventWriteSyncOpts, TxResult, SyncTreeOpts } from "./types.js";
import { AnyContract, CachedTree, copyCachedTree, copyTree, TREE_TYPE, Trees } from "@warptoad/skinny-fat-imt-js";
import type { ReadonlyLeanIMT } from "@warptoad/skinny-fat-imt-js";
//import { queryEventInChunks } from "./viem-utils.js";


import { UnionOmit, WriteContractParameters } from "viem"
import { GIGA_BRIDGE_ADDRESS, gigaBridgeAbi, poseidon2IMTHashFunc } from "./config.js";
import { GigaTreeCache, GigaTreePinned, GigaTreeWrite, SyncTreePinned, SyncTreeWrite } from "./interfaces/IGigaBridge.js";
import { treeWith } from "./utils.js";

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
    private async _updateLeaf(value: bigint, index: bigint, txOpts: ViemTxOpts = {}, { skipSync = false, ...syncOpts }: WriteSyncOpts = {}): Promise<RootResult> {
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
    private async _registerNewLeaf(value: bigint, owner: Address, updater: Address, txOpts: ViemTxOpts = {}, { skipSync = false, ...syncOpts }: WriteSyncOpts = {}): Promise<RegisterLeafResult> {
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
    private async _createNewSyncTree(values: bigint[], indexes: bigint[], txOpts: ViemTxOpts = {}, { skipSync = false, ...syncOpts }: EventWriteSyncOpts = {}): Promise<RootResult> {
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

    private async _transferOwnerOfLeafIndex(index: bigint, newOwner: Address, txOpts: ViemTxOpts = {}): Promise<TxResult> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.transferOwnerOfLeafIndex([index, newOwner], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
        return {
            txHash, txReceipt,
        }
    }

    private async _setUpdaterOfLeafIndex(index: bigint, newUpdater: Address, txOpts: ViemTxOpts = {}): Promise<TxResult> {
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

    private async _syncPinnedGigaTree({ pinFollowsHead = true, syncToRoot, fullNodeMode = true, eventChunkSize, storageChunkSize }: { pinFollowsHead?: boolean, syncToRoot?: bigint, updatePin?: boolean, fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
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
