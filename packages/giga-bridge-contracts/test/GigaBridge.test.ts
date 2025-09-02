import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { network } from "hardhat";

// import Poseidon2Yul from "../artifacts/poseidon2-evm/src/Poseidon2Yul.sol/Poseidon2Yul.json" assert {type: "json"}
// const Poseidon2HuffByteCode = "0x" + await compileHuff("./node_modules/poseidon2-evm/src/huff/Poseidon2.huff");
import Poseidon2HuffArtifacts from "../huff_artifacts/NODE_MODULES/POSEIDON2-EVM/SRC/HUFF/POSEIDON2.HUFF.json" with {type: "json"}
const Poseidon2HuffByteCode = Poseidon2HuffArtifacts.bytecode;

import Poseidon2TestArtifact from "../artifacts/contracts/test/testPoseidon.sol/testPoseidon.json" with {type: "json"}

import { getContract, getContractAddress, Hex, PublicClient, WalletClient } from "viem";
import { create2Proxy } from "../../giga-bridge-js/src/poseidon2/create2Proxy.ts";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { compileHuff } from "../scripts/deploy/compileHuff.js";
import { deployPoseidon2Huff } from "../../giga-bridge-js/src/poseidon2/deployPoseidon2.js";
import { GigaBridge$Type } from "../artifacts/contracts/giga-bridge/GigaBridge.sol/artifacts.js";
import LazyImtPoseidon2Artifact from "../artifacts/contracts/imt-poseidon2/LazyImtPoseidon2.sol/LazyImtPoseidon2.json" with {type: "json"}
import GigaBridgeArtifact from "../artifacts/contracts/giga-bridge/GigaBridge.sol/GigaBridge.json" with {type: "json"}


describe("Poseidon2", async function () {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();

    beforeEach(async () => {
        const [deployer] = await viem.getWalletClients()
        const { fundOneTimeAddressTx, proxyDeployTx, poseidon2DeployTx } = await deployPoseidon2Huff(publicClient, deployer, "0x0000000000000000000000000000000000000000000000000000000000000000")

    })
    it("Should deploy gigaBridge", async function () {
        const [alice, bob] = await viem.getWalletClients()
        const LazyIMT = await viem.deployContract("LazyImtPoseidon2")
        const gigaBridgeDeployer = await viem.deployContract("GigaBridge",[32],{libraries:{LazyImtPoseidon2:LazyIMT.address}})
        const aliceAddress = (await alice.getAddresses())[0]
        const gigaBridgeAlice = getContract({abi:gigaBridgeDeployer.abi, address:gigaBridgeDeployer.address, client:alice})
        console.log({aliceAddress})
        //@ts-ignore
        let txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 69])
        //@ts-ignore
        const updaterAddress =  await gigaBridgeAlice.read.indexPerUpdater([0])
        console.log({updaterAddress})
        //@ts-ignore
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 420])
        console.log({txHash})
        //@ts-ignore
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 4201])
                //@ts-ignore
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 4202])
                //@ts-ignore
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 4203])
                //@ts-ignore
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 4204])
                //@ts-ignore
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 4205])
                //@ts-ignore
        txHash = await gigaBridgeAlice.write.registerNewLeaf([aliceAddress, aliceAddress, 4206])
        //@ts-ignore
        txHash = await gigaBridgeAlice.write.updateLeaf([420420, 1])
        //@ts-ignore
        txHash = await gigaBridgeAlice.write.createPendingSyncTree([0, [69,420,4201, 4202,4203,4204, 4205, 4206], [0,1,2,3,4,5,6,7]])
        //@ts-ignore
        txHash = await gigaBridgeAlice.write.processSyncTree([0, 10])
  
    })
});
