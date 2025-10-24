import { ByteArray, getContractAddress, Hex, PublicClient, TestClient, WalletClient } from "viem"
import { create2Proxy } from "./create2Proxy.js"
import Poseidon2HuffByteCode from "./poseidon2HuffByteCode.json" with {type: "json"}

import {Poseidon2HuffWithInterfaceArtifact} from "../../../gigabridge-contracts/src/index.js" //with {type: "json"}

export function getPoseidon2HuffAddress(salt: Hex) {
    return getContractAddress({ bytecode: "0x" + Poseidon2HuffByteCode.slice(2) as Hex, opcode: "CREATE2", from: create2Proxy.address, salt: salt })
}

export function getPoseidon2HuffInterfaceAddress(salt: Hex) {
    return getContractAddress({ bytecode: "0x" + Poseidon2HuffWithInterfaceArtifact.bytecode.slice(2) as Hex, opcode: "CREATE2", from: create2Proxy.address, salt: salt })
}

export async function deployPoseidon2Huff(publicClient: PublicClient, deployer: WalletClient, huffSalt: Hex) {
    const proxyExist = Boolean(await publicClient.getCode({ address: create2Proxy.address }))
    let fundOneTimeAddressTx;
    let proxyDeployTx;
    if (proxyExist === false) {
        //@ts-ignore idk how to fix it, it some how requires kzg blob field. what??
        fundOneTimeAddressTx = await deployer.sendTransaction({
            to: create2Proxy.from,
            value: create2Proxy.gas
        })
        await publicClient.waitForTransactionReceipt({
            hash: fundOneTimeAddressTx,
            confirmations: 1,
        })
        proxyDeployTx = await deployer.sendRawTransaction({ serializedTransaction: create2Proxy.tx })
        await publicClient.waitForTransactionReceipt({
            hash: proxyDeployTx,
            confirmations: 1,
        })
    }
    const poseidon2HuffAddress = getPoseidon2HuffAddress(huffSalt)
    const poseidon2HuffExist = Boolean(await publicClient.getCode({ address: poseidon2HuffAddress }))
    //huff
    let poseidon2HuffDeployTx
    if (poseidon2HuffExist == false) {
        //@ts-ignore idk how to fix it, it some how requires kzg blob field. what??
        poseidon2HuffDeployTx = await deployer.sendTransaction({
            data: huffSalt + Poseidon2HuffByteCode.slice(2) as Hex,
            to: create2Proxy.address,
        })
        await publicClient.waitForTransactionReceipt({
            hash: poseidon2HuffDeployTx,
            confirmations: 1,
        })
    }
    return {poseidon2HuffAddress,  fundOneTimeAddressTx, proxyDeployTx, poseidon2HuffDeployTx}
}

export async function deployPoseidon2HuffWithInterface(publicClient: PublicClient, deployer: WalletClient, huffSalt: Hex, interfaceSalt: Hex) {
    const {poseidon2HuffAddress, fundOneTimeAddressTx, proxyDeployTx, poseidon2HuffDeployTx} = await deployPoseidon2Huff(publicClient, deployer, huffSalt)
    
    const poseidon2HuffWithInterfaceAddress = getPoseidon2HuffInterfaceAddress(huffSalt)
    const poseidon2HuffWithInterfaceExist = Boolean(await publicClient.getCode({ address: poseidon2HuffWithInterfaceAddress }))
    //huff with interface 
    let poseidon2HuffWithInterface2DeployTx
    if (poseidon2HuffWithInterfaceExist == false) {
        //@ts-ignore idk how to fix it, it some how requires kzg blob field. what??
        poseidon2HuffWithInterface2DeployTx = await deployer.sendTransaction({
            data: interfaceSalt + Poseidon2HuffWithInterfaceArtifact.bytecode.slice(2) as Hex,
            to: create2Proxy.address,
        })
        await publicClient.waitForTransactionReceipt({
            hash: poseidon2HuffWithInterface2DeployTx,
            confirmations: 1,
        })
    }

    console.log("all deployed?", {create2Proxy:Boolean(await publicClient.getCode({ address: create2Proxy.address })),poseidon2HuffAddress: Boolean(await publicClient.getCode({ address: poseidon2HuffAddress })), poseidon2HuffWithInterfaceAddress: Boolean(await publicClient.getCode({ address: poseidon2HuffWithInterfaceAddress }))})
    return {
        addresses: { create2ProxyAddress: create2Proxy.address, poseidon2HuffAddress, poseidon2HuffWithInterfaceAddress },
        txs: { fundOneTimeAddressTx, proxyDeployTx, poseidon2HuffDeployTx, Poseidon2HuffWithInterface2DeployTx: poseidon2HuffWithInterface2DeployTx }
    }
}