import { getContractAddress, Hex, PublicClient, TestClient, WalletClient } from "viem"
import { create2Proxy } from "./create2Proxy.js"
import Poseidon2HuffByteCode from "./poseidon2HuffByteCode.json" with {type: "json"}

export async function deployPoseidon2Huff(publicClient: PublicClient, deployer: WalletClient, salt:Hex) {
    const proxyExist = Boolean(await publicClient.getCode({ address: create2Proxy.address }))
    let fundOneTimeAddressTx;
    let proxyDeployTx;
    if (proxyExist === false) {
        fundOneTimeAddressTx = await deployer.sendTransaction({
            to: create2Proxy.from, value: create2Proxy.gas,
            account: null, //(await deployer.getAddresses())[0],
            chain: undefined //await publicClient.getChainId()
        })
        proxyDeployTx = deployer.sendRawTransaction({ serializedTransaction: create2Proxy.tx })
    }
    //huff
    const poseidon2DeployTx = await deployer.sendTransaction({
        data: salt + Poseidon2HuffByteCode.slice(2) as Hex, to: create2Proxy.address,
        account: null,
        chain: undefined
    })

    return { fundOneTimeAddressTx, proxyDeployTx, poseidon2DeployTx }
}

export function getPoseidon2HuffAddress(salt:Hex) {
    return getContractAddress({bytecode:"0x"+Poseidon2HuffByteCode as Hex, opcode:"CREATE2", from:create2Proxy.address, salt: salt})
} 