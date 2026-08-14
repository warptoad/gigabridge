import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";
import { Trees } from "@warptoad/skinny-fat-imt-js";

// import Poseidon2Yul from "../artifacts/poseidon2-evm/src/Poseidon2Yul.sol/Poseidon2Yul.json" assert {type: "json"}
// const Poseidon2HuffByteCode = "0x" + await compileHuff("./node_modules/poseidon2-evm/src/huff/Poseidon2.huff");
import Poseidon2HuffArtifacts from "../huff_artifacts/NODE_MODULES/POSEIDON2-EVM/SRC/HUFF/POSEIDON2.HUFF.json" with {type: "json"}
//const Poseidon2HuffByteCode = Poseidon2HuffArtifacts.bytecode;

//import Poseidon2TestArtifact from "../artifacts/contracts/test/testPoseidon.sol/testPoseidon.json" with {type: "json"}

import { getContract, getContractAddress, GetContractReturnType, Hash, Hex, parseEventLogs, PublicClient, toHex, Transaction, TransactionReceipt, WalletClient } from "viem";
//import { create2Proxy } from "../../gigabridge-js/src/poseidon2/create2Proxy.js";
//import { poseidon2Hash } from "@zkpassport/poseidon2"
//import { compileHuff } from "../scripts/compile/compileHuff.js";
import { deployPoseidon2HuffWithInterface } from "../../gigabridge-js/src/poseidon2/deployPoseidon2.js";
//import { GigaBridge$Type } from "../artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js";
//import LazyImtPoseidon2Artifact from "../artifacts/contracts/imt-poseidon2/LazyImtPoseidon2.sol/LazyImtPoseidon2.json" with {type: "json"}
import GigaBridgeArtifact from "../artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"}
//TODO import this from index
import { registerNewLeaf, updateLeaf } from "../../gigabridge-js/src/gigaBridge.js"
import { FatImtContractName, FatImtReadContractName, GigaBridgeContractName, GigaBridgeContractTestType, SkinnyImtContractName, SkinnyImtReadContractName } from "../src/index.js";

/** IGigaBridge.RootType. `rootHistory` is a mapping, so a root that was never seen reads as NOT_A_ROOT. */
const RootType = { NOT_A_ROOT: 0, GIGA_ROOT: 1, SYNC_ROOT: 2 } as const

describe("gigaBridge", async function () {
    //@ts-ignore
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    let gigaBridge: GigaBridgeContractTestType;

    beforeEach(async () => {
        // no poseidon2 hasher contract to deploy anymore: fat-imt/skinny-imt hash with inlined yul (LibPoseidon2Yul)
        const fatImt = await viem.deployContract(FatImtContractName)
        const skinnyImt = await viem.deployContract(SkinnyImtContractName)
        const fatImtRead = await viem.deployContract(FatImtReadContractName)
        const skinnyImtRead = await viem.deployContract(SkinnyImtReadContractName)
        gigaBridge = await viem.deployContract(GigaBridgeContractName, [], {
            libraries: {
                [FatImtReadContractName]: fatImtRead.address,
                [SkinnyImtReadContractName]: skinnyImtRead.address,
                [FatImtContractName]: fatImt.address,
                [SkinnyImtContractName]: skinnyImt.address
            }
        })
    })

    /**
     * The root `createNewSyncTree` ended up with, which is the one `addSyncRootToHistory` stored.
     * skinny-imt emits a NewRoot per insert, so the tx holds one per leaf (plus the gigaTree's own), and
     * the reset at the end adds a final `NewRoot(id, 0, 0)`. Dropping the size 0 ones leaves the inserts,
     * of which the last is the finished tree.
     */
    function syncRootOf(txReceipt: TransactionReceipt, syncTreeId: bigint) {
        const newRootEvents = parseEventLogs({
            abi: gigaBridge.abi,
            eventName: 'NewRoot',
            logs: txReceipt.logs,
        }).filter((event) => event.args.treeId === syncTreeId && event.args.size > 0n)
        assert(newRootEvents.length > 0, `no NewRoot event of a non empty tree for treeId:${syncTreeId} in tx:${txReceipt.transactionHash}`)
        return newRootEvents[newRootEvents.length - 1].args.root
    }

    /** fills the gigaTree with `amount` leafs, valued 0..amount, and returns what went in where */
    async function registerLeafs(amount: bigint, wallet: WalletClient) {
        const owner = (await wallet.getAddresses())[0]
        const updater = owner // usually this a contract, but today we use a EOA because we are lazy!!
        const indexes: bigint[] = []
        const values: bigint[] = []
        let txHash: Hash = "0x00"
        for (let value = 0n; value < amount; value++) {
            const registered = await registerNewLeaf({ args: [owner, updater, value], gigaBridge, client: { publicClient, wallet } })
            txHash = registered.txHash
            indexes.push(registered.index)
            values.push(value)
        }
        return { indexes, values, txHash }
    }

    describe("syncTree", async function () {
        it("Should create a sync tree with a lott of zeros", async function () {
            const [alice, bob] = await viem.getWalletClients()
            const aliceAddress = (await alice.getAddresses())[0]
            const gigaBridgeAlice = getContract({ abi: gigaBridge.abi, address: gigaBridge.address, client: { wallet: alice, public: publicClient } })

            let gigaRoot = await gigaBridgeAlice.read.gigaRoot()
            const { txHash: registerLeafTx } = await registerLeafs(2n ** 4n, alice)

            const updaterAddress = await gigaBridgeAlice.read.indexPerUpdater([0n])
            gigaRoot = await gigaBridgeAlice.read.gigaRoot()
            const syncTreeId = await gigaBridge.read.syncTreeId();

            const createSyncTreeTxHash = await gigaBridgeAlice.write.createNewSyncTree([[0n, 1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n]])
            const createSyncTreeReceipt = await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash })
            const syncRoot = syncRootOf(createSyncTreeReceipt, syncTreeId)

            const jsTrees = new Trees(gigaBridge.address, publicClient)
            // TODO be nice to have a sync a single treeId and get one object. then a sync multiple or all for multiple
            const syncTreeJs = (await jsTrees.sync([syncTreeId], { syncToRoot: syncRoot }))[toHex(syncTreeId)]

            // the gaps between the leaf indexes are filled with zeros onchain, so js has to see them too
            assert.deepEqual(syncTreeJs.tree.leaves, [0n, 1n, 0n, 0n, 4n, 5n, 0n, 7n], "sync tree wasn't zero filled the way the contract filled it")
            assert.equal(syncTreeJs.tree.root, syncRoot, "reconstructed sync tree root doesn't match the one emitted onchain")
            const isRoot = await gigaBridge.read.rootHistory([syncTreeJs.tree.root as bigint])
            assert(isRoot !== RootType.NOT_A_ROOT, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))
            console.log({
                gas: {
                    createSyncTree: (await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash as Hash })).gasUsed,
                    registerLeaf: (await publicClient.getTransactionReceipt({ hash: registerLeafTx as Hash })).gasUsed,
                    gigaDepth: await gigaBridge.read.gigaDepth()
                }
            })
        })


        it("Should create a sync tree in one go", async function () {
            const [alice, bob] = await viem.getWalletClients()
            const aliceAddress = (await alice.getAddresses())[0]

            const gigaBridgeAlice = getContract({ abi: gigaBridge.abi, address: gigaBridge.address, client: { wallet: alice, public: publicClient } })

            let gigaRoot = await gigaBridgeAlice.read.gigaRoot()

            const { txHash: registerLeafTx } = await registerLeafs(2n ** 4n, alice)

            const updaterAddress = await gigaBridgeAlice.read.indexPerUpdater([0n])
            gigaRoot = await gigaBridgeAlice.read.gigaRoot()
            const syncTreeId = await gigaBridge.read.syncTreeId();

            // warm to the slots so we can test gas!
            await gigaBridgeAlice.write.createNewSyncTree([[0n, 1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n]])
            const createSyncTreeTxHash = await gigaBridgeAlice.write.createNewSyncTree([[0n, 1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n]])

            const createSyncTreeTxReceipt = await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash });
            const syncRoot = syncRootOf(createSyncTreeTxReceipt, syncTreeId)

            const jsTrees = new Trees(gigaBridge.address, publicClient)
            // the syncTree is reset at the end of every createNewSyncTree, so storage only ever holds an
            // empty tree: syncToRoot is what makes the lib walk the events back to the tree of this tx
            const syncTreeJs = (await jsTrees.sync([syncTreeId], { syncToRoot: syncRoot }))[toHex(syncTreeId)]

            assert.deepEqual(syncTreeJs.tree.leaves, [0n, 1n, 0n, 0n, 4n, 5n, 0n, 7n], "sync tree wasn't zero filled the way the contract filled it")
            assert.equal(syncTreeJs.tree.root, syncRoot, "reconstructed sync tree root doesn't match the one emitted onchain")
            const isRoot = await gigaBridge.read.rootHistory([syncTreeJs.tree.root as bigint])
            assert(isRoot !== RootType.NOT_A_ROOT, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))

            console.log({
                gas: {
                    createSyncTree: createSyncTreeTxReceipt.gasUsed,
                    registerLeaf: (await publicClient.getTransactionReceipt({ hash: registerLeafTx as Hash })).gasUsed,
                    gigaDepth: await gigaBridge.read.gigaDepth()
                }
            })
        })

        it("Should create a very big sync tree in one go", async function () {
            const [alice, bob] = await viem.getWalletClients()
            const aliceAddress = (await alice.getAddresses())[0]

            const gigaBridgeAlice = getContract({ abi: gigaBridge.abi, address: gigaBridge.address, client: { wallet: alice, public: publicClient } })

            let gigaRoot = await gigaBridgeAlice.read.gigaRoot()

            const { indexes, values, txHash: registerLeafTx } = await registerLeafs(2n ** 5n, alice)

            const updaterAddress = await gigaBridgeAlice.read.indexPerUpdater([0n])
            gigaRoot = await gigaBridgeAlice.read.gigaRoot()
            const syncTreeId = await gigaBridge.read.syncTreeId();

            // warm to the slots so we can test gas!
            await gigaBridgeAlice.write.createNewSyncTree([values, indexes])
            const createSyncTreeTxHash = await gigaBridgeAlice.write.createNewSyncTree([values, indexes])

            const createSyncTreeTxReceipt = await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash });
            const syncRoot = syncRootOf(createSyncTreeTxReceipt, syncTreeId)

            const jsTrees = new Trees(gigaBridge.address, publicClient)
            const syncTreeJs = (await jsTrees.sync([syncTreeId], { syncToRoot: syncRoot }))[toHex(syncTreeId)]

            // every index is taken here, so there is nothing to zero fill and the sync tree is the giga tree
            assert.deepEqual(syncTreeJs.tree.leaves, values, "sync tree doesn't hold the leafs it was built with")
            assert.equal(syncTreeJs.tree.root, syncRoot, "reconstructed sync tree root doesn't match the one emitted onchain")
            const isRoot = await gigaBridge.read.rootHistory([syncTreeJs.tree.root as bigint])
            assert(isRoot !== RootType.NOT_A_ROOT, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))

            console.log({
                gas: {
                    createSyncTree: createSyncTreeTxReceipt.gasUsed,
                    registerLeaf: (await publicClient.getTransactionReceipt({ hash: registerLeafTx as Hash })).gasUsed,
                    gigaDepth: await gigaBridge.read.gigaDepth()
                }
            })
        })


    });

    describe("gigaTree", async function () {
        it("should insert leafs in the gigaTree and be reproduced in js", async function () {
            const [alice, bob] = await viem.getWalletClients()
            const aliceAddress = (await alice.getAddresses())[0]
            const { values, txHash: registerNewLeafTx } = await registerLeafs(2n ** 4n, alice)

            // make sure the sync gets the correct leafs even if they update
            let updateLeafTx = await updateLeaf({ args: [420n, 2n], gigaBridge, client: { publicClient, wallet: alice } })
            updateLeafTx = await updateLeaf({ args: [69n, 2n], gigaBridge, client: { publicClient, wallet: alice } })
            updateLeafTx = await updateLeaf({ args: [420n, 1n], gigaBridge, client: { publicClient, wallet: alice } })
            const expectedLeafs = [...values]
            expectedLeafs[2] = 69n     // last write of index 2 wins, the 420n before it is history
            expectedLeafs[1] = 420n

            const gigaTreeId = await gigaBridge.read.gigaTreeId()
            const onchainRoot = await gigaBridge.read.gigaRoot()

            // the gigaTree is a fat imt, so all of its leafs are readable straight from storage
            const jsTrees = new Trees(gigaBridge.address, publicClient)
            const gigaTreeJs = (await jsTrees.sync([gigaTreeId]))[toHex(gigaTreeId)]
            assert.deepEqual(gigaTreeJs.tree.leaves, expectedLeafs, "storage synced tree doesn't hold the leafs that were registered/updated")
            assert.equal(gigaTreeJs.tree.root, onchainRoot, "storage synced jsRoot doesn't match the onChainRoot")

            // and the same tree over events, with a chunk size small enough that getLogs has to walk many
            // chunks. That is the path that has to piece the updates back together in the right order
            const jsTreesFromEvents = new Trees(gigaBridge.address, publicClient)
            const gigaTreeJsFromEvents = (await jsTreesFromEvents.sync([gigaTreeId], { fullNodeMode: false, eventChunkSize: 2n }))[toHex(gigaTreeId)]
            assert.deepEqual(gigaTreeJsFromEvents.tree.leaves, expectedLeafs, "event synced tree doesn't hold the leafs that were registered/updated")
            assert.equal(gigaTreeJsFromEvents.tree.root, onchainRoot, "event synced jsRoot doesn't match the onChainRoot")

            console.log({
                gas: {
                    updateLeaf: (await publicClient.getTransactionReceipt({ hash: updateLeafTx })).gasUsed,
                    registerNewLeaf: (await publicClient.getTransactionReceipt({ hash: registerNewLeafTx })).gasUsed,
                    gigaDepth: await gigaBridge.read.gigaDepth()
                }
            })
        })
    });
});
