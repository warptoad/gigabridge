// from: https://github.com/chancehudson/poseidon-solidity/blob/main/index.js
// see more info https://github.com/Arachnid/deterministic-deployment-proxy

import {Address, TransactionSerializedGeneric } from "viem"

// this is a presigned tx from a one time address, which can only deploy a create2 proxy contract at this address: 0x7A0D94F55792C434d74a40883C6ed8545E406D12
// there exist no private key for this one time address
// this is to ensure the proxy contract address is always the same, which also means that we can always deploy our contracts to the same address using this create2 proxy!
export const create2Proxy: create2ProxyData = {
    from: '0x3fab184622dc19b6109349b94811493bf2a45362', // the onetime address
    gas: 10000000000000000n,
    tx: '0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222',
    address: '0x4e59b44847b379578588920ca78fbf26c0b4956c', // the proxy contract address
}

export type create2ProxyData = {
    from: Address,
    gas: bigint,
    tx: TransactionSerializedGeneric,
    address: Address
}