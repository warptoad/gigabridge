import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

// import Poseidon2Yul from "../artifacts/poseidon2-evm/src/Poseidon2Yul.sol/Poseidon2Yul.json" assert {type: "json"}
// const Poseidon2HuffByteCode = "0x" + await compileHuff("./node_modules/poseidon2-evm/src/huff/Poseidon2.huff");
import Poseidon2HuffArtifacts from "../huff_artifacts/NODE_MODULES/POSEIDON2-EVM/SRC/HUFF/POSEIDON2.HUFF.json" //with {type: "json"}
const Poseidon2HuffByteCode = Poseidon2HuffArtifacts.bytecode;

import Poseidon2TestArtifact from "../artifacts/contracts/test/testPoseidon.sol/testPoseidon.json"// with {type: "json"}

import { getContract, getContractAddress, GetContractReturnType, Hex, parseEventLogs, PublicClient, toHex, WalletClient } from "viem";
import { create2Proxy } from "../../gigabridge-js/src/poseidon2/create2Proxy.js";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { compileHuff } from "../scripts/compile/compileHuff.js";
import { deployPoseidon2HuffWithInterface } from "../../gigabridge-js/src/poseidon2/deployPoseidon2.js";
import { GigaBridge$Type } from "../artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js";
import LazyImtPoseidon2Artifact from "../artifacts/contracts/imt-poseidon2/LazyImtPoseidon2.sol/LazyImtPoseidon2.json" //with {type: "json"}
import GigaBridgeArtifact from "../artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" //with {type: "json"}
import {getSyncTree} from "../../gigabridge-js/src/gigaBridge.js"
import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";

const expectedPoseidon2HuffWithInterfaceAddress = "0x68f2bf1DBd3e5BAad91A79081bC989a2F34Dc02F" // this is also hardcoded in LazyIMTPoseidon2 thats why

const GigaBridgeContractName = "GigaBridge"
const ImtContractName = "LazyImtPoseidon2"

describe("Poseidon2", async function () {
    //@ts-ignore
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    let gigaBridge: ContractReturnType<typeof GigaBridgeContractName>;

    beforeEach(async () => {
        const [deployer] = await viem.getWalletClients()
        const salt = "0x0000000000000000000000000000000000000000000000000000000000000000"
        const {addresses:{poseidon2HuffWithInterfaceAddress}} = await deployPoseidon2HuffWithInterface(publicClient as any as PublicClient, deployer as WalletClient, salt, salt)
        console.log({poseidon2HuffWithInterfaceAddress})
        assert.equal(poseidon2HuffWithInterfaceAddress, expectedPoseidon2HuffWithInterfaceAddress, "poseidon2HuffWithInterfaceAddress not equal to expected value that is hardcoded in LazyImtPoseidon2.sol")

        const LazyIMT = await viem.deployContract(ImtContractName)
        gigaBridge = await viem.deployContract(GigaBridgeContractName,[32],{libraries:{LazyImtPoseidon2:LazyIMT.address}})
    })

    it("Should create a sync tree in batches", async function () {
        const [alice, bob] = await viem.getWalletClients()
        const aliceAddress = (await alice.getAddresses())[0]
        
        const gigaBridgeAlice = getContract({abi:gigaBridge.abi, address:gigaBridge.address, client:{wallet:alice, public:publicClient}})

        let gigaRoot = await gigaBridgeAlice.read.gigaRoot()

        for (let i = 0n; i < 10n; i++) {
            await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, i])
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

        const syncTreeJs = (await getSyncTree(createSyncTreeTxHash,publicClient,gigaBridge.address))[0]
        const isRoot = await gigaBridge.read.rootHistory([syncTreeJs.root as bigint])
        assert(isRoot, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))
        //console.log({syncTree})
    })


    it("Should create a sync tree in one go", async function () {
        const [alice, bob] = await viem.getWalletClients()
        const aliceAddress = (await alice.getAddresses())[0]
        
        const gigaBridgeAlice = getContract({abi:gigaBridge.abi, address:gigaBridge.address, client:{wallet:alice, public:publicClient}})

        let gigaRoot = await gigaBridgeAlice.read.gigaRoot()

        for (let i = 0n; i < 10n; i++) {
            await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, i])
        }

        const updaterAddress =  await gigaBridgeAlice.read.indexPerUpdater([0n])
        gigaRoot = await gigaBridgeAlice.read.gigaRoot()
        
        // warm to the slots so we can test gas!
        await gigaBridgeAlice.write.createNewSyncTree([[0n ,1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n]])
        const createSyncTreeTxHash = await gigaBridgeAlice.write.createNewSyncTree([[0n ,1n, 4n, 5n, 7n], [0n, 1n, 4n, 5n, 7n]])
        
        const createSyncTreeTxHReceipt = await publicClient.getTransactionReceipt({ hash: createSyncTreeTxHash });
        const argsNewRootEvent = (parseEventLogs({
            abi: GigaBridgeArtifact.abi,
            eventName: 'NewRoot',
            logs: createSyncTreeTxHReceipt.logs,
        })[0] as any).args

        const syncTreeJs = (await getSyncTree(createSyncTreeTxHash,publicClient,gigaBridge.address))[0]
        const isRoot = await gigaBridge.read.rootHistory([syncTreeJs.root as bigint])
        assert(isRoot, ("built sync tree wrong, reconstructed tree root doesn't exist onchain"))

        console.log({gasUsed: createSyncTreeTxHReceipt.gasUsed})
    })
});
