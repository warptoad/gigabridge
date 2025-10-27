// this exports viem contract types and artifacts from aztec, and renames them

import { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
export const GigaBridgeContractName = "GigaBridge"
export const ImtContractName = "LazyImtPoseidon2"
export type GigaBridgeContractTestType = ContractReturnType<typeof GigaBridgeContractName>

export { default as GigaBridgeArtifact } from "../artifacts/contracts/gigabridge/GigaBridge.sol/GigaBridge.json" //with {type: "json"}
//export { IGigaBridge$Type } from "../artifacts/contracts/gigabridge/interfaces/IGigaBridge.sol/artifacts.js"
export { default as Poseidon2HuffWithInterfaceArtifact } from "../artifacts/contracts/imt-poseidon2/Poseidon2HuffWithInterface.sol/Poseidon2HuffWithInterface.json" //with {type: "json"}
export { MainContractArtifact as aztecAdapterL2Artifact } from "../contracts/adapters/aztec/aztec_adapter_l2/src/artifacts/Main.js"
