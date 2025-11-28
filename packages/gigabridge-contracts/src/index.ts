// this exports viem contract types and artifacts from aztec, and renames them

import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
export const GigaBridgeContractName = "GigaBridge"
export const ImtContractName = "LazyImtPoseidon2"
export type GigaBridgeContractTestType = ContractReturnType<typeof GigaBridgeContractName>

export { default as GigaBridgeArtifact } from "../artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" with {type: "json"}
//export { IGigaBridge$Type } from "../artifacts/contracts/gigabridge/interfaces/IGigaBridge.sol/artifacts.js"
export { default as Poseidon2HuffWithInterfaceArtifact } from "../artifacts/contracts/imt-poseidon2/Poseidon2HuffWithInterface.sol/Poseidon2HuffWithInterface.json" with {type: "json"}

export { MainContract as AztecAdapterL2$Type, MainContractArtifact as AztecAdapterL2Artifact } from "../contracts/adapters/aztec/aztec_adapter_l2/target/artifacts/Main.js"
export type {  AztecAdapterL1$Type } from "../artifacts/contracts/adapters/aztec/AztecAdapterL1.sol/artifacts.d.js"
export { default as AztecAdapterL1Artifact} from  "../artifacts/contracts/adapters/aztec/AztecAdapterL1.sol/AztecAdapterL1.json" with {type: "json"}