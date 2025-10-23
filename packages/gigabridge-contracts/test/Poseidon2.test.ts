import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

// import Poseidon2Yul from "../artifacts/poseidon2-evm/src/Poseidon2Yul.sol/Poseidon2Yul.json" assert {type: "json"}
// const Poseidon2HuffByteCode = "0x" + await compileHuff("./node_modules/poseidon2-evm/src/huff/Poseidon2.huff");
import Poseidon2HuffArtifacts from "../huff_artifacts/NODE_MODULES/POSEIDON2-EVM/SRC/HUFF/POSEIDON2.HUFF.json" with {type: "json"}
const Poseidon2HuffByteCode = Poseidon2HuffArtifacts.bytecode;

import Poseidon2TestArtifact from "../artifacts/contracts/test/testPoseidon.sol/testPoseidon.json" with {type: "json"}

import { getContract, getContractAddress, Hex, parseEventLogs, PublicClient, toHex, WalletClient } from "viem";
import { create2Proxy } from "../../gigabridge-js/src/poseidon2/create2Proxy.ts";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { compileHuff } from "../scripts/compile/compileHuff.ts";
import { deployPoseidon2HuffWithInterface } from "../../gigabridge-js/src/poseidon2/deployPoseidon2.js";
import GigaBridgeArtifact from "../artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"}


describe("Poseidon2", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  it("Should deploy poseidon and successfully hashes something using Poseidon2Yul", async function () {
    const [deployer, alice,bob] = await viem.getWalletClients()
    const salt: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000"
    // TODO hardhat get messy with types here because of optimism support 
    const {addresses:{poseidon2HuffWithInterfaceAddress}} = await deployPoseidon2HuffWithInterface(publicClient as any as PublicClient, deployer as WalletClient, salt, salt)
    console.log({poseidon2HuffWithInterfaceAddress})
    const poseidon2ContractAddress = getContractAddress({bytecode:"0x"+Poseidon2HuffByteCode as Hex, opcode:"CREATE2", from:create2Proxy.address, salt: salt})
    // yul recompile
    // await deployer.sendTransaction({data:salt+Poseidon2Yul.bytecode.slice(2) as Hex, to:create2Proxy.address})
    // const poseidon2ContractAddress = getContractAddress({bytecode:Poseidon2Yul.bytecode as Hex, opcode:"CREATE2", from:create2Proxy.address, salt: salt})
    const byteCodeAtPoseidon2 = await publicClient.getCode({address:poseidon2ContractAddress})
    assert(byteCodeAtPoseidon2 !== undefined, "Poseidon2 does not have byte code at that address, deployment failed")
    
    const testPoseidon = await viem.deployContract("testPoseidon") 
    const preImg:[bigint, bigint] = [1n,2n]
    //@ts-ignore fucking hardhat man
    const hashTx1 = await publicClient.getTransactionReceipt({hash:await testPoseidon.write.hashPayable([preImg])})
    //@ts-ignore fucking hardhat man
    const hashTx2 = await publicClient.getTransactionReceipt({hash:await testPoseidon.write.hashPayable([preImg])})
    //@ts-ignore fucking hardhat man
    const hashPoseidonYul = await testPoseidon.read.hash([preImg])
    const poseidon2Js = poseidon2Hash([1n,2n])
    console.log({poseidon2Js, hashPoseidonYul, gasUsed:hashTx2.gasUsed, poseidon2ContractAddress})
    assert(poseidon2Js === hashPoseidonYul, "hash from Poseidon2Yul onchain doesn't match the one done in js")
    const zerosHuff = new Array(256).fill(0n)
    for (let index = 1; index < zerosHuff.length; index++) {
        //zeros[index] = poseidon2Hash([zeros[index-1],zeros[index-1]]);
        zerosHuff[index] =await testPoseidon.read.hash([[zerosHuff[index-1],zerosHuff[index-1]]]);
    }


    const zerosJs = new Array(256).fill(0n)
    for (let index = 1; index < zerosJs.length; index++) {
        zerosJs[index] = poseidon2Hash([zerosJs[index-1],zerosJs[index-1]]);
    }
    assert.deepStrictEqual(zerosHuff,zerosJs, "0 hashing is not equal between js and huff implementation")
  })
});
