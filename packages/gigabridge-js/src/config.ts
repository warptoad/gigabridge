import { GigaBridge$Type } from "packages/gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js";
import { GigaBridgeArtifact, GigaBridgeContractTestType } from "../../gigabridge-contracts/src/index.js";
import { poseidon2Hash } from "@zkpassport/poseidon2";
import { LeanIMTHashFunction } from "@zk-kit/lean-imt";
import { Address } from "viem";

const GIGA_BRIDGE_DEPLOYMENT_BLOCKS: { [chainId: number]: bigint; } = {

}

// i hate typescript, this the one way to turn the fucking json thing into const and viem needs that otherwise it just forgets what function you can call on gigaBridge.write.
// the json import widens everything to string/never[], so borrow the literal abi tuple hardhat already generated in artifacts.d.ts
export const gigaBridgeAbi = GigaBridgeArtifact.abi as unknown as GigaBridge$Type["abi"]  ;

// TODO default address
export const GIGA_BRIDGE_ADDRESS: Address = "0x0000000000000000000000000000000000000000"
export const poseidon2IMTHashFunc: LeanIMTHashFunction = (a: bigint, b: bigint) => poseidon2Hash([a, b])