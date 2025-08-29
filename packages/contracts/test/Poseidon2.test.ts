import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

//import Poseidon2Yul from "../artifacts/poseidon2-evm/src/Poseidon2Yul.sol/Poseidon2Yul.json" assert {type: "json"}
const Poseidon2HuffByteCode = "0x" + await compileHuff("./node_modules/poseidon2-evm/src/huff/Poseidon2.huff");


import { getContractAddress, Hex } from "viem";
import { create2Proxy } from "../scripts/deploy/create2Proxy.js";
import { poseidon2Hash } from "@zkpassport/poseidon2"
import { compileHuff } from "../scripts/deploy/compileHuff.js";

describe("Poseidon2", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  it("Should deploy poseidon and successfully hashes something using Poseidon2Yul", async function () {
    const [deployer, alice,bob] = await viem.getWalletClients()
    const proxyExist = Boolean(await publicClient.getCode({address:create2Proxy.address}) )
    if (proxyExist === false) {
      await deployer.sendTransaction({to:create2Proxy.from, value: create2Proxy.gas})
      const proxyTxHash = deployer.sendRawTransaction({serializedTransaction: create2Proxy.tx})
    }
    const salt: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000"
    //huff
    await deployer.sendTransaction({data:salt+Poseidon2HuffByteCode.slice(2) as Hex, to:create2Proxy.address})
    const poseidon2ContractAddress = getContractAddress({bytecode:Poseidon2HuffByteCode as Hex, opcode:"CREATE2", from:create2Proxy.address, salt: salt})
    // yul recompile
    // await deployer.sendTransaction({data:salt+Poseidon2Yul.bytecode.slice(2) as Hex, to:create2Proxy.address})
    // const poseidon2ContractAddress = getContractAddress({bytecode:Poseidon2Yul.bytecode as Hex, opcode:"CREATE2", from:create2Proxy.address, salt: salt})
    console.log({poseidon2ContractAddress})
    const byteCodeAtPoseidon2 = await publicClient.getCode({address:poseidon2ContractAddress})
    assert(byteCodeAtPoseidon2 !== undefined, "Poseidon2 does not have byte code at that address, deployment failed")
    const poseidon2Yul = viem.getContractAt("Poseidon2Yul",poseidon2ContractAddress)
    
    const testPoseidon = await viem.deployContract("testPoseidon")
    const preImg:[bigint, bigint] = [1n,2n]
    const hashTx1 = await publicClient.getTransactionReceipt({hash:await testPoseidon.write.hashPayable([preImg])})
    const hashTx2 = await publicClient.getTransactionReceipt({hash:await testPoseidon.write.hashPayable([preImg])})
    const hashPoseidonYul = await testPoseidon.read.hash([preImg])
    const poseidon2Js = poseidon2Hash([1n,2n])
    console.log({poseidon2Js, hashPoseidonYul, gasUsed:hashTx2.gasUsed})


    assert(poseidon2Js === hashPoseidonYul, "hash from Poseidon2Yul onchain doesn't match the one done in js")
  })
});
