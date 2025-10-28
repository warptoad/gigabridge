import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

// import Poseidon2Yul from "../artifacts/poseidon2-evm/src/Poseidon2Yul.sol/Poseidon2Yul.json" assert {type: "json"}
// const Poseidon2HuffByteCode = "0x" + await compileHuff("./node_modules/poseidon2-evm/src/huff/Poseidon2.huff");
import Poseidon2HuffArtifacts from "../huff_artifacts/NODE_MODULES/POSEIDON2-EVM/SRC/HUFF/POSEIDON2.HUFF.json" with {type: "json"}
const Poseidon2HuffByteCode = Poseidon2HuffArtifacts.bytecode;

import Poseidon2TestArtifact from "../artifacts/contracts/test/testPoseidon.sol/testPoseidon.json" with {type: "json"}

import { getContract, getContractAddress, GetContractReturnType, Hash, Hex, parseEventLogs, PublicClient, toHex, Transaction, TransactionReceipt, WalletClient } from "viem";
import { create2Proxy } from "../../gigabridge-js/src/poseidon2/create2Proxy.js";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { compileHuff } from "../scripts/compile/compileHuff.js";
import { deployPoseidon2HuffWithInterface } from "../../gigabridge-js/src/poseidon2/deployPoseidon2.js";
import { GigaBridge$Type } from "../artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js";
import LazyImtPoseidon2Artifact from "../artifacts/contracts/imt-poseidon2/LazyImtPoseidon2.sol/LazyImtPoseidon2.json" with {type: "json"}
import GigaBridgeArtifact from "../artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"}
//TODO import this from index
import {getGigaTree, getSyncTree, registerNewLeaf, updateLeaf} from "../../gigabridge-js/src/gigaBridge.js"
import { GigaBridgeContractName, GigaBridgeContractTestType, ImtContractName } from "../src/index.js";

const expectedPoseidon2HuffWithInterfaceAddress = "0x68f2bf1DBd3e5BAad91A79081bC989a2F34Dc02F" // this is also hardcoded in LazyIMTPoseidon2 thats why

describe("gigaBridge", async function () {
    //@ts-ignore
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    let gigaBridge: GigaBridgeContractTestType;
    
    beforeEach(async () => {
        const [deployer] = await viem.getWalletClients()
        const salt = "0x0000000000000000000000000000000000000000000000000000000000000000"
        const {addresses:{poseidon2HuffWithInterfaceAddress}} = await deployPoseidon2HuffWithInterface(publicClient as any as PublicClient, deployer as WalletClient, salt, salt, false)
        assert.equal(poseidon2HuffWithInterfaceAddress, expectedPoseidon2HuffWithInterfaceAddress, "poseidon2HuffWithInterfaceAddress not equal to expected value that is hardcoded in LazyImtPoseidon2.sol")

        const LazyIMT = await viem.deployContract(ImtContractName)
        gigaBridge = await viem.deployContract(GigaBridgeContractName,[32],{libraries:{LazyImtPoseidon2:LazyIMT.address}})
    })

    describe("syncTree", async function () {
        it("Should create a sync tree in batches", async function () {
            const [alice, bob] = await viem.getWalletClients()
            const aliceAddress = (await alice.getAddresses())[0]
            const gigaBridgeAlice = getContract({abi:gigaBridge.abi, address:gigaBridge.address, client:{wallet:alice, public:publicClient}})

            let gigaRoot = await gigaBridgeAlice.read.gigaRoot()
            let registerLeafTx:Hash = "0x00"
            for (let i = 0n; i <  2n**4n; i++) {
                const value = i
                const owner = aliceAddress
                const updater = aliceAddress
                const {index, txHash} = await registerNewLeaf({args:[owner, updater, value], gigaBridge, client:{publicClient, wallet:alice}})
                registerLeafTx = txHash
                
            }

            const updaterAddress =  await gigaBridgeAlice.read.indexPerUpdater([0n])
            gigaRoot = await gigaBridgeAlice.read.gigaRoot()

            const createSyncTreeTxHash = await gigaBridgeAlice.write.createPendingSyncTree([0n, [0n ,1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n]])
            
            let processSyncTreeTxHash = await gigaBridgeAlice.write.processSyncTree([0n, 2n]) 
            processSyncTreeTxHash = await gigaBridgeAlice.write.processSyncTree([0n, 2n])
            processSyncTreeTxHash = await gigaBridgeAlice.write.processSyncTree([0n, 100n])

            const processSyncTreeTxReceipt = await publicClient.getTransactionReceipt({ hash: processSyncTreeTxHash });
            const argsNewRootEvent = (parseEventLogs({
                abi: GigaBridgeArtifact.abi,
                eventName: 'NewRoot',
                logs: processSyncTreeTxReceipt.logs,
            })[0] as any).args

            const syncTreeJs = (await getSyncTree({txHash:createSyncTreeTxHash,publicClient,gigaBridge}))[0]
            const isRoot = await gigaBridge.read.rootHistory([syncTreeJs.root as bigint])
            assert(isRoot, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))
            console.log({gas:{
                createPendingSyncTree: (await publicClient.getTransactionReceipt({hash:createSyncTreeTxHash as Hash})).gasUsed,
                processSyncTree: processSyncTreeTxReceipt.gasUsed,
                registerLeaf: (await publicClient.getTransactionReceipt({hash:registerLeafTx as Hash})).gasUsed,
                gigaDepth: await gigaBridge.read.gigaDepth()
            }})
        })


        it("Should create a sync tree in one go", async function () {
            const [alice, bob] = await viem.getWalletClients()
            const aliceAddress = (await alice.getAddresses())[0]
            
            const gigaBridgeAlice = getContract({abi:gigaBridge.abi, address:gigaBridge.address, client:{wallet:alice, public:publicClient}})

            let gigaRoot = await gigaBridgeAlice.read.gigaRoot()

            let registerLeafTx:Hash = "0x00";
            for (let i = 0n; i < 2n**4n; i++) {
                const value = i
                const owner = aliceAddress
                const updater = aliceAddress
                const {index, txHash} = await registerNewLeaf({args:[owner, updater, value], gigaBridge, client:{publicClient, wallet:alice}})
                registerLeafTx = txHash
            }

            const updaterAddress =  await gigaBridgeAlice.read.indexPerUpdater([0n])
            gigaRoot = await gigaBridgeAlice.read.gigaRoot()
            
            // warm to the slots so we can test gas!
            await gigaBridgeAlice.write.createNewSyncTree([[0n ,1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n]])
            const createSyncTreeTxHash = await gigaBridgeAlice.write.createNewSyncTree([[0n ,1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n]])
            
            const createSyncTreeTxReceipt = await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash });
            const argsNewRootEvent = (parseEventLogs({
                abi: GigaBridgeArtifact.abi,
                eventName: 'NewRoot',
                logs: createSyncTreeTxReceipt.logs,
            })[0] as any).args

            const syncTreeJs = (await getSyncTree({txHash:createSyncTreeTxHash,publicClient,gigaBridge}))[0]
            const isRoot = await gigaBridge.read.rootHistory([syncTreeJs.root as bigint])
            assert(isRoot, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))

            console.log({gas:{
                createSyncTree: createSyncTreeTxReceipt.gasUsed,
                registerLeaf: (await publicClient.getTransactionReceipt({hash:registerLeafTx as Hash})).gasUsed,
                gigaDepth: await gigaBridge.read.gigaDepth()
            }}) 
        })

        it("Should create a very big sync tree in one go", async function () {
            const [alice, bob] = await viem.getWalletClients()
            const aliceAddress = (await alice.getAddresses())[0]
            
            const gigaBridgeAlice = getContract({abi:gigaBridge.abi, address:gigaBridge.address, client:{wallet:alice, public:publicClient}})

            let gigaRoot = await gigaBridgeAlice.read.gigaRoot()

            let registerLeafTx:Hash = "0x00";
            const indexes:bigint[] = [];
            const values:bigint[] = []
            for (let i = 0n; i < 2n**8n; i++) {
                const value = i
                const owner = aliceAddress
                const updater = aliceAddress
                const {index, txHash} = await registerNewLeaf({args:[owner, updater, value], gigaBridge, client:{publicClient, wallet:alice}})
                registerLeafTx = txHash
                values.push(value)
                indexes.push(index)
            }

            const updaterAddress =  await gigaBridgeAlice.read.indexPerUpdater([0n])
            gigaRoot = await gigaBridgeAlice.read.gigaRoot()
            
            // warm to the slots so we can test gas!
            await gigaBridgeAlice.write.createNewSyncTree([values, indexes])
            const createSyncTreeTxHash = await gigaBridgeAlice.write.createNewSyncTree([values, indexes])
            
            const createSyncTreeTxReceipt = await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash });
            const argsNewRootEvent = (parseEventLogs({
                abi: GigaBridgeArtifact.abi,
                eventName: 'NewRoot',
                logs: createSyncTreeTxReceipt.logs,
            })[0] as any).args

            const syncTreeJs = (await getSyncTree({txHash:createSyncTreeTxHash,publicClient,gigaBridge}))[0]
            const isRoot = await gigaBridge.read.rootHistory([syncTreeJs.root as bigint])
            assert(isRoot, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))

            console.log({gas:{
                createSyncTree: createSyncTreeTxReceipt.gasUsed,
                registerLeaf: (await publicClient.getTransactionReceipt({hash:registerLeafTx as Hash})).gasUsed,
                gigaDepth: await gigaBridge.read.gigaDepth()
            }}) 
        })

        
    });

    describe("gigaTree", async function () {
        it("should insert leafs in the gigaTree and be reproduced in js", async function () {
            const [alice, bob] = await viem.getWalletClients()
            const aliceAddress = (await alice.getAddresses())[0]
            const indexes:bigint[] = []
            let registerNewLeafTx: Hash = "0x00"
            for (let i = 1n; i < 2n**4n; i++) {
                const owner = aliceAddress;
                const updater = aliceAddress;   // usually this a contract, but today we use a EOA because we are lazy!!
                const value = i                 // usually a root of a commitment tree or state tree, but can be anything! (like a number!)
                const {index, txHash} = await registerNewLeaf({args:[owner, updater, value], gigaBridge, client:{publicClient, wallet:alice}})
                registerNewLeafTx = txHash
                indexes.push(index)
            }
            // make sure getGigaTree gets the correct leafs even if they update
            let updateLeafTx = await updateLeaf({args:[420n, 2n], gigaBridge, client:{publicClient, wallet:alice}})
            updateLeafTx = await updateLeaf({args:[69n, 2n], gigaBridge, client:{publicClient, wallet:alice}})
            updateLeafTx = await updateLeaf({args:[420n, 1n], gigaBridge, client:{publicClient, wallet:alice}})
            // TODO more testing hash to be done on getGigaTree because here it get all logs in a single chunk, so make a test where the chunk size of queryEventInChunks
            const tree = await getGigaTree({gigaBridge, publicClient})
            const jsRoot = tree.root 
            const onchainRoot = await gigaBridge.read.gigaRoot()
            assert(jsRoot == onchainRoot, "jsRoot doesn't match the onChainRoot")
            console.log({gas:{
                updateLeaf:(await publicClient.getTransactionReceipt({hash:updateLeafTx})).gasUsed,
                registerNewLeaf: (await publicClient.getTransactionReceipt({hash:registerNewLeafTx})).gasUsed,
                gigaDepth: await gigaBridge.read.gigaDepth()
            }})
        })
    });
});
