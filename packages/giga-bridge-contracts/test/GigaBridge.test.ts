import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

// import Poseidon2Yul from "../artifacts/poseidon2-evm/src/Poseidon2Yul.sol/Poseidon2Yul.json" assert {type: "json"}
// const Poseidon2HuffByteCode = "0x" + await compileHuff("./node_modules/poseidon2-evm/src/huff/Poseidon2.huff");
import Poseidon2HuffArtifacts from "../huff_artifacts/NODE_MODULES/POSEIDON2-EVM/SRC/HUFF/POSEIDON2.HUFF.json" with {type: "json"}
const Poseidon2HuffByteCode = Poseidon2HuffArtifacts.bytecode;

import Poseidon2TestArtifact from "../artifacts/contracts/test/testPoseidon.sol/testPoseidon.json" with {type: "json"}

import { getContract, getContractAddress, Hex, parseEventLogs, PublicClient, toHex, WalletClient } from "viem";
import { create2Proxy } from "../../giga-bridge-js/src/poseidon2/create2Proxy.ts";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { compileHuff } from "../scripts/deploy/compileHuff.js";
import { deployPoseidon2HuffWithInterface } from "../../giga-bridge-js/src/poseidon2/deployPoseidon2.js";
import { GigaBridge$Type } from "../artifacts/contracts/giga-bridge/GigaBridge.sol/artifacts.js";
import LazyImtPoseidon2Artifact from "../artifacts/contracts/imt-poseidon2/LazyImtPoseidon2.sol/LazyImtPoseidon2.json" with {type: "json"}
import GigaBridgeArtifact from "../artifacts/contracts/giga-bridge/GigaBridge.sol/GigaBridge.json" with {type: "json"}
import {getSyncTree} from "../../giga-bridge-js/src/gigaBridge.ts"
const expectedPoseidon2HuffWithInterfaceAddress = "0x5308AdF8a2B46dfe32a00503adD831174586FC16" // this is also hardcoded in LazyIMTPoseidon2 thats why

describe("Poseidon2", async function () {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();

    beforeEach(async () => {
        const [deployer] = await viem.getWalletClients()
        const salt = "0x0000000000000000000000000000000000000000000000000000000000000000"
        const {addresses:{poseidon2HuffWithInterfaceAddress}} = await deployPoseidon2HuffWithInterface(publicClient as any as PublicClient, deployer as WalletClient, salt, salt)
        console.log({poseidon2HuffWithInterfaceAddress})
        assert.equal(poseidon2HuffWithInterfaceAddress, expectedPoseidon2HuffWithInterfaceAddress, "poseidon2HuffWithInterfaceAddress not equal to expected value that is hardcoded in LazyImtPoseidon2.sol")

    })
    it("Should deploy gigaBridge", async function () {
        const [alice, bob] = await viem.getWalletClients()
        const LazyIMT = await viem.deployContract("LazyImtPoseidon2")
        const gigaBridgeDeployer = await viem.deployContract("GigaBridge",[32],{libraries:{LazyImtPoseidon2:LazyIMT.address}})
        const aliceAddress = (await alice.getAddresses())[0]
        
        const gigaBridgeAlice = getContract({abi:gigaBridgeDeployer.abi, address:gigaBridgeDeployer.address, client:{wallet:alice, public:publicClient}})

        let gigaRoot = await gigaBridgeAlice.read.gigaRoot()

        let txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 0n])
        gigaRoot = await gigaBridgeAlice.read.gigaRoot()

        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 1n])
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 2n])
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 3n])
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 4n])
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 5n])
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 6n])
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 7n])
        // txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 4207n])
        //txHash = await gigaBridgeAlice.write.updateLeaf([420420n, 1n])

        const updaterAddress =  await gigaBridgeAlice.read.indexPerUpdater([0n])
        gigaRoot = await gigaBridgeAlice.read.gigaRoot()

        
        const createSyncTreeTxHash = await gigaBridgeAlice.write.createPendingSyncTree([0n, [1n, 4n, 5n, 7n], [1n, 4n, 5n, 7n]])
        
        let processSyncTreeTxHash = await gigaBridgeAlice.write.processSyncTree([0n, 3000n]) 
        // processSyncTreeTxHash = await gigaBridgeAlice.write.processSyncTree([0n, 2n])
        // processSyncTreeTxHash = await gigaBridgeAlice.write.processSyncTree([0n, 100n])

        const processSyncTreeTxReceipt = await publicClient.getTransactionReceipt({ hash: processSyncTreeTxHash });
        const argsNewRootEvent = (parseEventLogs({
            abi: GigaBridgeArtifact.abi,
            eventName: 'NewRoot',
            logs: processSyncTreeTxReceipt.logs,
        })[0] as any).args

        const syncTree = await getSyncTree(createSyncTreeTxHash,publicClient,gigaBridgeAlice.address)
        console.log({syncTree})
    })
});
