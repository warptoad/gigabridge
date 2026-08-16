import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

// import Poseidon2Yul from "../artifacts/poseidon2-evm/src/Poseidon2Yul.sol/Poseidon2Yul.json" assert {type: "json"}
// const Poseidon2HuffByteCode = "0x" + await compileHuff("./node_modules/poseidon2-evm/src/huff/Poseidon2.huff");
import Poseidon2HuffArtifacts from "../huff_artifacts/NODE_MODULES/POSEIDON2-EVM/SRC/HUFF/POSEIDON2.HUFF.json" with {type: "json"}
//const Poseidon2HuffByteCode = Poseidon2HuffArtifacts.bytecode;

import { Hash } from "viem";
//TODO import this from index
import { ConnectedWalletClient, GigaBridge } from "../../gigabridge-js/src/GigaBridge.js"
import { FatImtContractName, FatImtReadContractName, GigaBridgeContractName, GigaBridgeContractTestType, SkinnyImtContractName, SkinnyImtReadContractName } from "../src/index.js";

/** IGigaBridge.RootType. `rootHistory` is a mapping, so a root that was never seen reads as NOT_A_ROOT. */
const RootType = { NOT_A_ROOT: 0, GIGA_ROOT: 1, SYNC_ROOT: 2 } as const

describe("gigaBridge", async function () {
    //@ts-ignore
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    /** the raw contract, only kept around for the reads the GigaBridge class doesn't expose */
    let gigaBridgeContract: GigaBridgeContractTestType;
    let gigaBridge: GigaBridge;
    let alice: ConnectedWalletClient;
    let bob: ConnectedWalletClient;

    beforeEach(async () => {
        // no poseidon2 hasher contract to deploy anymore: fat-imt/skinny-imt hash with inlined yul (LibPoseidon2Yul)
        const fatImt = await viem.deployContract(FatImtContractName)
        const skinnyImt = await viem.deployContract(SkinnyImtContractName)
        const fatImtRead = await viem.deployContract(FatImtReadContractName)
        const skinnyImtRead = await viem.deployContract(SkinnyImtReadContractName)
        gigaBridgeContract = await viem.deployContract(GigaBridgeContractName, [], {
            libraries: {
                [FatImtReadContractName]: fatImtRead.address,
                [SkinnyImtReadContractName]: skinnyImtRead.address,
                [FatImtContractName]: fatImt.address,
                [SkinnyImtContractName]: skinnyImt.address
            }
        });
        [alice, bob] = await viem.getWalletClients() as ConnectedWalletClient[]
        gigaBridge = new GigaBridge(publicClient, alice, gigaBridgeContract.address)
    })

    /** fills the gigaTree with `amount` leafs, valued 0..amount, and returns what went in where */
    async function registerLeafs(amount: bigint, wallet: ConnectedWalletClient) {
        const owner = wallet.account.address
        const updater = owner // usually this a contract, but today we use a EOA because we are lazy!!
        const indexes: bigint[] = []
        const values: bigint[] = []
        let txHash: Hash = "0x00"
        gigaBridge.connectWallet(wallet)
        for (let value = 0n; value < amount; value++) {
            const registered = await gigaBridge.registerNewLeaf(value, owner, updater)
            txHash = registered.txHash
            indexes.push(registered.index)
            values.push(value)
        }
        return { indexes, values, txHash }
    }

    describe("syncTree", async function () {
        it("Should create a sync tree with a lott of zeros", async function () {
            const { txHash: registerLeafTx } = await registerLeafs(2n ** 4n, alice)

            const { txHash: createSyncTreeTxHash, root: syncRoot } = await gigaBridge.createNewSyncTree([0n, 1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n])

            // the syncTree is reset at the end of every createNewSyncTree, so storage only ever holds an
            // empty tree: pinning to the root of this tx is what makes the class walk the events back to it
            await gigaBridge.pinSyncRootTx(createSyncTreeTxHash)

            // the gaps between the leaf indexes are filled with zeros onchain, so js has to see them too
            assert.deepEqual(gigaBridge.syncTree.pinned.leaves, [0n, 1n, 0n, 0n, 4n, 5n, 0n, 7n], "sync tree wasn't zero filled the way the contract filled it")
            assert.equal(gigaBridge.syncTree.pinned.root, syncRoot, "reconstructed sync tree root doesn't match the one emitted onchain")
            const isRoot = await gigaBridgeContract.read.rootHistory([gigaBridge.syncTree.pinned.root as bigint])
            assert(isRoot !== RootType.NOT_A_ROOT, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))
            console.log({
                gas: {
                    createSyncTree: (await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash })).gasUsed,
                    registerLeaf: (await publicClient.getTransactionReceipt({ hash: registerLeafTx as Hash })).gasUsed,
                    gigaDepth: await gigaBridgeContract.read.gigaDepth()
                }
            })
        })


        it("Should create a sync tree in one go", async function () {
            const { txHash: registerLeafTx } = await registerLeafs(2n ** 4n, alice)

            // warm to the slots so we can test gas!
            await gigaBridge.createNewSyncTree([0n, 1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n])
            const { txHash: createSyncTreeTxHash, root: syncRoot } = await gigaBridge.createNewSyncTree([0n, 1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n])

            await gigaBridge.pinSyncRootTx(createSyncTreeTxHash)

            assert.deepEqual(gigaBridge.syncTree.pinned.leaves, [0n, 1n, 0n, 0n, 4n, 5n, 0n, 7n], "sync tree wasn't zero filled the way the contract filled it")
            assert.equal(gigaBridge.syncTree.pinned.root, syncRoot, "reconstructed sync tree root doesn't match the one emitted onchain")
            const isRoot = await gigaBridgeContract.read.rootHistory([gigaBridge.syncTree.pinned.root as bigint])
            assert(isRoot !== RootType.NOT_A_ROOT, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))

            console.log({
                gas: {
                    createSyncTree: (await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash })).gasUsed,
                    registerLeaf: (await publicClient.getTransactionReceipt({ hash: registerLeafTx as Hash })).gasUsed,
                    gigaDepth: await gigaBridgeContract.read.gigaDepth()
                }
            })
        })

        it("Should create a very big sync tree in one go", async function () {
            const { indexes, values, txHash: registerLeafTx } = await registerLeafs(2n ** 5n, alice)

            // warm to the slots so we can test gas!
            await gigaBridge.createNewSyncTree(values, indexes)
            const { txHash: createSyncTreeTxHash, root: syncRoot } = await gigaBridge.createNewSyncTree(values, indexes)

            await gigaBridge.pinSyncRootTx(createSyncTreeTxHash)

            // every index is taken here, so there is nothing to zero fill and the sync tree is the giga tree
            assert.deepEqual(gigaBridge.syncTree.pinned.leaves, values, "sync tree doesn't hold the leafs it was built with")
            assert.equal(gigaBridge.syncTree.pinned.root, syncRoot, "reconstructed sync tree root doesn't match the one emitted onchain")
            const isRoot = await gigaBridgeContract.read.rootHistory([gigaBridge.syncTree.pinned.root as bigint])
            assert(isRoot !== RootType.NOT_A_ROOT, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))

            console.log({
                gas: {
                    createSyncTree: (await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash })).gasUsed,
                    registerLeaf: (await publicClient.getTransactionReceipt({ hash: registerLeafTx as Hash })).gasUsed,
                    gigaDepth: await gigaBridgeContract.read.gigaDepth()
                }
            })
        })

        it("Should refuse to sync a leaf that was never in the gigaTree", async function () {
            await registerLeafs(2n ** 2n, alice)

            // 420n was never written to index 0, so it isn't in leafHistory and the class should catch it
            // before it ever costs a tx
            await assert.rejects(
                () => gigaBridge.createNewSyncTree([420n], [0n]),
                /never found in leaf history/,
                "createNewSyncTree accepted a leaf that never existed onchain"
            )
        })
    });

    describe("gigaTree", async function () {
        it("should insert leafs in the gigaTree and be reproduced in js", async function () {
            const { values, txHash: registerNewLeafTx } = await registerLeafs(2n ** 4n, alice)

            // make sure the sync gets the correct leafs even if they update
            let updateLeafTx = (await gigaBridge.updateLeaf(420n, 2n)).txHash
            updateLeafTx = (await gigaBridge.updateLeaf(69n, 2n)).txHash
            updateLeafTx = (await gigaBridge.updateLeaf(420n, 1n)).txHash
            const expectedLeafs = [...values]
            expectedLeafs[2] = 69n     // last write of index 2 wins, the 420n before it is history
            expectedLeafs[1] = 420n

            const onchainRoot = await gigaBridgeContract.read.gigaRoot()

            // the gigaTree is a fat imt, so all of its leafs are readable straight from storage
            await gigaBridge.sync()
            assert.deepEqual(gigaBridge.gigaTree.pinned.leaves, expectedLeafs, "storage synced tree doesn't hold the leafs that were registered/updated")
            assert.equal(gigaBridge.gigaTree.pinned.root, onchainRoot, "storage synced jsRoot doesn't match the onChainRoot")

            // and the same tree over events, with a chunk size small enough that getLogs has to walk many
            // chunks. That is the path that has to piece the updates back together in the right order
            const gigaBridgeFromEvents = new GigaBridge(publicClient, alice, gigaBridgeContract.address)
            await gigaBridgeFromEvents.sync({ fullNodeMode: false, eventChunkSize: 2n })
            assert.deepEqual(gigaBridgeFromEvents.gigaTree.pinned.leaves, expectedLeafs, "event synced tree doesn't hold the leafs that were registered/updated")
            assert.equal(gigaBridgeFromEvents.gigaTree.pinned.root, onchainRoot, "event synced jsRoot doesn't match the onChainRoot")

            console.log({
                gas: {
                    updateLeaf: (await publicClient.getTransactionReceipt({ hash: updateLeafTx })).gasUsed,
                    registerNewLeaf: (await publicClient.getTransactionReceipt({ hash: registerNewLeafTx })).gasUsed,
                    gigaDepth: await gigaBridgeContract.read.gigaDepth()
                }
            })
        })

        it("should pin the gigaTree to an older root", async function () {
            const { values } = await registerLeafs(2n ** 3n, alice)
            await gigaBridge.sync()

            // the root right after the registers, before anything updates on top of it
            const rootBeforeUpdate = await gigaBridgeContract.read.gigaRoot()
            const { txHash: updateTx, root: rootAfterUpdate } = await gigaBridge.updateLeaf(69n, 2n)

            await gigaBridge.pinGigaRoot(rootBeforeUpdate)
            assert.deepEqual(gigaBridge.gigaTree.pinned.leaves, values, "pinned gigaTree doesn't hold the leafs of the root it was pinned to")
            assert.equal(gigaBridge.gigaTree.pinned.root, rootBeforeUpdate, "pinned gigaTree root doesn't match the root it was pinned to")

            // and the same pin, but found from the tx that made the root
            await gigaBridge.pinGigaRootTx(updateTx)
            const expectedLeafs = [...values]
            expectedLeafs[2] = 69n
            assert.deepEqual(gigaBridge.gigaTree.pinned.leaves, expectedLeafs, "gigaTree pinned by tx doesn't hold the leafs of that tx")
            assert.equal(gigaBridge.gigaTree.pinned.root, rootAfterUpdate, "gigaTree pinned by tx doesn't match the root that tx emitted")
        })

        it("should let the owner hand over ownership and the updater slot", async function () {
            const aliceAddress = alice.account.address
            const bobAddress = bob.account.address
            const { index } = await gigaBridge.registerNewLeaf(1n, aliceAddress, aliceAddress)

            await gigaBridge.setUpdaterOfLeafIndex(index, bobAddress)
            gigaBridge.connectWallet(bob)
            const { root } = await gigaBridge.updateLeaf(42n, index)
            assert.equal(root, await gigaBridgeContract.read.gigaRoot(), "update by the new updater didn't land onchain")

            gigaBridge.connectWallet(alice)
            await gigaBridge.transferOwnerOfLeafIndex(index, bobAddress)
            assert.equal((await gigaBridgeContract.read.indexPerOwner([index])).toLowerCase(), bobAddress.toLowerCase(), "leaf index wasn't transferred to the new owner")
        })
    });

    describe("tree getters", async function () {
        it("should expose functions that still work when taken off the getter", async function () {
            const aliceAddress = alice.account.address
            // destructured, so these only work if the getter handed out bound methods
            const { insertLeaf, updateLeaf } = gigaBridge.gigaTree
            const { index } = await insertLeaf(0n, aliceAddress, aliceAddress)
            const { root: rootAfterUpdate } = await updateLeaf(69n, index)

            const { pinRoot: pinGigaRoot } = gigaBridge.gigaTree
            await pinGigaRoot(rootAfterUpdate)
            assert.deepEqual(gigaBridge.gigaTree.pinned.leaves, [69n], "pinRoot off the gigaTree getter didn't pin the tree")

            const { createNew, pinTx } = gigaBridge.syncTree
            const { txHash } = await createNew([69n], [index])
            await pinTx(txHash)
            assert.deepEqual(gigaBridge.syncTree.pinned.leaves, [69n], "createNew/pinTx off the syncTree getter didn't build the tree")
        })

        it("should hand out a pinned tree that stays on its root when the pin moves", async function () {
            const { values } = await registerLeafs(2n ** 2n, alice)
            await gigaBridge.sync()

            const rootBeforeUpdate = await gigaBridgeContract.read.gigaRoot()
            await gigaBridge.pinGigaRoot(rootBeforeUpdate)
            const pinnedAtOldRoot = gigaBridge.gigaTree.pinned

            // pinned isn't copied on the way out, so re-pinning has to replace the tree, not grow it
            const { root: rootAfterUpdate } = await gigaBridge.updateLeaf(69n, 2n)
            await gigaBridge.pinGigaRoot(rootAfterUpdate)

            assert.deepEqual(pinnedAtOldRoot.leaves, values, "a pinned tree handed out earlier moved when the pin did")
            assert.equal(pinnedAtOldRoot.root, rootBeforeUpdate, "a pinned tree handed out earlier no longer matches the root it was pinned to")
        })
    });
});
