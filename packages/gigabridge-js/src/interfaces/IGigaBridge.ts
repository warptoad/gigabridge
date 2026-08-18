
/**
 * @notice every interface below is written in method syntax (`f(): T`) rather than as properties holding
 * function types (`f: () => T`). Both typecheck the same, but tsserver reports a property whose type is a
 * function as `property`, so the IDE gives it the variable icon and drops the doc comment. Method syntax
 * reports as `method`. The GigaBridge impls behind these are private and bound in, so this is the only
 * declaration a caller ever sees, and it has to be the one carrying the docs.
 */

import { Address, Hex } from "viem"
import { EventSyncOpts, EventWriteSyncOpts, GigaSyncOpts, RegisterLeafResult, RootResult, SyncOpts, TxResult, ViemTxOpts, WriteSyncOpts } from "../types.js"
import { LeanIMT } from "@zk-kit/lean-imt"

/** the writes that land on the gigaTree. All of them need a connected wallet. */
export interface GigaTreeWrite {
    /**
     * Inserts a new leaf into the gigaTree and registers `owner` as its owner and `updater` as the only
     * address allowed to change it afterwards.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    insertLeaf(value: bigint, owner: Address, updater: Address, txOpts?: ViemTxOpts, syncOpts?: WriteSyncOpts): Promise<RegisterLeafResult>
    /**
     * Overwrites the gigaTree leaf at `index`. The connected wallet must be its registered updater.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    updateLeaf(value: bigint, index: bigint, txOpts?: ViemTxOpts, syncOpts?: WriteSyncOpts): Promise<RootResult>
    /**
     * Hands the right to update `index` to `newUpdater`. The connected wallet must be its owner.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    changeLeafUpdater(index: bigint, newUpdater: Address, txOpts?: ViemTxOpts): Promise<TxResult>
    /**
     * Hands ownership of `index` to `newOwner`, who can then pick the updater. The connected wallet must
     * be its current owner.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    transferLeafOwner(index: bigint, newOwner: Address, txOpts?: ViemTxOpts): Promise<TxResult>
}

/** the writes that build a syncTree. Needs a connected wallet. */
export interface SyncTreeWrite {
    /**
     * Builds a new syncTree out of leaves the gigaTree has held before, zero filling the gaps between the
     * indexes. Throws before it costs a tx if a value was never at its index. The tree is reset onchain at
     * the end of the same tx, so pin the root to see it: {@link SyncTreePinned.pinTx}.
     * @param txOpts - the usual viem tx options (`gas`, `nonce`, …), minus `account`/`chain`
     */
    createNew(values: bigint[], indexes: bigint[], txOpts?: ViemTxOpts, syncOpts?: EventWriteSyncOpts): Promise<RootResult>
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