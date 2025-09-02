import { ByteArray, getContractAddress, Hex, PublicClient, TestClient, WalletClient } from "viem"
import { create2Proxy } from "./create2Proxy.js"
import Poseidon2HuffByteCode from "./poseidon2HuffByteCode.json" with {type: "json"}

export async function deployPoseidon2Huff(publicClient: PublicClient, deployer: WalletClient, salt:Hex) {
    const proxyExist = Boolean(await publicClient.getCode({ address: create2Proxy.address }))
    let fundOneTimeAddressTx;
    let proxyDeployTx;
    if (proxyExist === false) {
        //@ts-ignore idk how to fix it, it some how requires kzg blob field. what??
        fundOneTimeAddressTx = await deployer.sendTransaction({
            to: create2Proxy.from, 
            value: create2Proxy.gas
        })
        proxyDeployTx = deployer.sendRawTransaction({ serializedTransaction: create2Proxy.tx })
    }
    //huff
     //@ts-ignore idk how to fix it, it some how requires kzg blob field. what??
    const poseidon2DeployTx = await deployer.sendTransaction({
        data: salt + Poseidon2HuffByteCode.slice(2) as Hex, 
        to: create2Proxy.address,
    })

    return { fundOneTimeAddressTx, proxyDeployTx, poseidon2DeployTx }
}

export function getPoseidon2HuffAddress(salt:Hex) {
    return getContractAddress({bytecode:"0x"+Poseidon2HuffByteCode as Hex, opcode:"CREATE2", from:create2Proxy.address, salt: salt})
} 