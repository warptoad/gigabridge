import { Account, Address, Chain, Client, GetContractParameters, GetContractReturnType, Hex, PublicClient, TransactionReceipt, Transport, UnionOmit, WalletClient, WriteContractParameters} from "viem"
import { GigaBridge$Type }  from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js"
import { LeanIMT } from "@zk-kit/lean-imt";

export type atLeastOneCLient =
  | {
      publicClient?: PublicClient;
      wallet: WalletClient;
    }
  | {
      publicClient: PublicClient;
      wallet?: WalletClient;
    };

export type GigaBridgeContractWithWalletClient = GetContractReturnType<GigaBridge$Type["abi"], Required<{public?: PublicClient; wallet: WalletClient;}>>
export type GigaBridgeContract = GetContractReturnType<GigaBridge$Type["abi"], Required<{public?: PublicClient;wallet?: WalletClient;}>>

/** works on all optional transaction option when doing contract.write.function([], {...required, ...ViemTxOpts}) 
 * But uses `GigaBridge$Type["abi"], "updateLeaf"` because claude couldn't find a nice way to extract these keys :/
*/
export type ViemTxOpts = UnionOmit<
    WriteContractParameters<GigaBridge$Type["abi"], "updateLeaf">,
    "abi" | "address" | "functionName" | "args" | "account" | "chain"
>
export type ConnectedWalletClient = WalletClient & { account: Account }

export type SyncTreeOpts = { syncToRoot?: bigint, attemptFastSizeMatch?: boolean, updatePin?: boolean, fullNodeMode?: boolean, eventChunkSize?: bigint, storageChunkSize?: bigint }

export type GigaBridgeReadContract = GetContractReturnType<GigaBridge$Type["abi"], PublicClient, Address>;
export type GigaBridgeWriteContract = GetContractReturnType<GigaBridge$Type["abi"], { public: PublicClient, wallet: WalletClient }, Address>;

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