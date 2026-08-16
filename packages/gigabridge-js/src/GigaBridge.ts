
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
            const [gigaId, syncId] = await Promise.all([await this.contract.read.gigaTreeId(), await this.contract.read.syncTreeId()])
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
    private async _updateLeaf(value: bigint, index: bigint, txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt, root: bigint, treeSize: bigint }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.updateLeaf([value, index], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
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
    private async _registerNewLeaf(value: bigint, owner: Address, updater: Address, txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt, index: bigint, root: bigint, treeSize: bigint }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.registerNewLeaf([value, owner, updater], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
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
    private async _createNewSyncTree(values: bigint[], indexes: bigint[], txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt, root: bigint, treeSize: bigint }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')

        // catch caller mistake early if the provide a leaf that has not existed
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
        return {
            txHash, txReceipt,
            root: newRootEvent.args.root,
            treeSize: newRootEvent.args.size,
        }
    }

    private async _transferOwnerOfLeafIndex(index: bigint, newOwner: Address, txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.transferOwnerOfLeafIndex([index, newOwner], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
        return {
            txHash, txReceipt,
        }
    }

    private async _setUpdaterOfLeafIndex(index: bigint, newUpdater: Address, txOpts: TxOpts = {}): Promise<{ txHash: Hex, txReceipt: TransactionReceipt }> {
        await this.init()
        if (this.walletClient === undefined) throw new Error('No wallet connected')
        const txHash = await this.contract!.write.setUpdaterOfLeafIndex([index, newUpdater], { account: this.walletClient.account, chain: this.walletClient.chain, ...txOpts })
        const txReceipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash })
        return {
            txHash, txReceipt,
        }
    }

    // {fullNodeMode, blockNumber, attemptFastSizeMatch, syncToRoot, eventChunkSize, storageChunkSize, hasRepeatedLeafs, insertOnlyTree, autoDiscovery}:{ fullNodeMode?: boolean, blockNumber?: bigint, attemptFastSizeMatch?: boolean, syncToRoot?: bigint, eventChunkSize?: bigint, storageChunkSize?: bigint, hasRepeatedLeafs?: boolean, insertOnlyTree?: boolean, autoDiscovery?: boolean | undefined } = {}
    private async _syncGigaTree({ updatePin = false, fullNodeMode, eventChunkSize, storageChunkSize }: { updatePin?: boolean, fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        await this.init()

        // initial sync (not sync tree, it resets every tx so not use full to sync like this)
        const gigaTree = (await this.trees.sync([BigInt(await this._getGigaTreeId())], {
            // settings
            fullNodeMode, eventChunkSize, storageChunkSize,
            // default
            attemptFastSizeMatch: false, // rarely works since leafs update so often 
            syncToRoot: undefined,
            hasRepeatedLeafs: false,    // gigaTree does not have that, this saves a bit on event scan
            insertOnlyTree: false,
            autoDiscovery: false
        }))[await this._getGigaTreeId()]

        if (updatePin || this.pinnedTrees?.gigaTree.lastSynced === 0n) {
            this.pinnedTrees.gigaTree = gigaTree
        }
        return copyTree(gigaTree.tree, this.hashFunction)
    }

    private async _syncGigaTreePinned({ fullNodeMode, eventChunkSize, storageChunkSize }: { updatePin?: boolean, fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        return await this._syncGigaTree({ updatePin: true, fullNodeMode, eventChunkSize, storageChunkSize })
    }

    // would pinning to block number ever need to exist?
    private async _pinGigaRoot(gigaRoot: bigint, { fullNodeMode, eventChunkSize, storageChunkSize }: { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        await this.init()
        const pin = (await this.trees!.sync([BigInt(await this._getGigaTreeId())], {
            // inputs
            syncToRoot: gigaRoot,
            // settings
            fullNodeMode, eventChunkSize, storageChunkSize,
            // default
            attemptFastSizeMatch: false, // rarely works since leafs update so often 
            hasRepeatedLeafs: false,    // gigaTree does not have that, this saves a bit on event scan
            insertOnlyTree: false,
            autoDiscovery: false
        }))[await this._getGigaTreeId()]
        this.pinnedTrees!.gigaTree = pin
        return pin
    }

    private async _pinSyncRoot(syncRoot: bigint, { eventChunkSize, storageChunkSize }: { fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint } = {}) {
        await this.init()
        const pin = (await this.trees!.sync([BigInt(await this._getSyncTreeId())], {
            // inputs
            syncToRoot: syncRoot,
            // settings
            eventChunkSize, storageChunkSize,
            // default
            fullNodeMode: false,
            attemptFastSizeMatch: false, // rarely works since leafs update so often 
            hasRepeatedLeafs: true,    // syncTree does have that
            insertOnlyTree: false,
            autoDiscovery: false
        }))[await this._getSyncTreeId()]
        this.pinnedTrees!.syncTree = pin
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
        // object) loses `this` and every `this.init()` inside them throws
        const transact = {
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
                return treeWith(tree, { sync: self._syncGigaTree.bind(self) })
            },

            /**
             * The tree as of the pinned root. Nothing else holds this one and pinning replaces it rather
             * than growing it, so what you get here keeps its root even after the pin moves on.
             */
            get pinned() {
                const tree = notInitialized ? new LeanIMT(self.hashFunction, []) : self.pinnedTrees.gigaTree.tree
                return treeWith(tree, {
                    sync: self._syncGigaTreePinned.bind(self),
                    pinRoot: self._pinGigaRoot.bind(self),
                    pinTx: self._pinGigaRootTx.bind(self),
                })
            },
            get lastSync(): bigint {
                return notInitialized ? 0n : self.trees.cache[self.id!.gigaTree].lastSynced
            },
            get write() {
                return transact
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
        const transact = {
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
                return treeWith(tree, {
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
