import { network } from "hardhat";
import AztecAdapterL1 from "../../ignition/modules/AztecAdapterL1.ts";
import { DeploymentParameters, ModuleParameters, ModuleParameterType } from "@nomicfoundation/ignition-core";
import { getAddress } from "viem";
import { AztecAdapter } from "../../../giga-bridge-js/src/index.ts";

const { ignition } = await network.connect();
// TODO figure out how to not cheese through the DeploymentParameters type
export const aztecAdapterL2 = "0x28ccf69c5aa64f73b07b6b910dd76ce35dde5df637749da7c8c48d7e11366a7d" as ModuleParameterType
const  aztecRollupRegistry = getAddress("0xc2f24280f5c7f4897370dfdeb30f79ded14f1c81") as ModuleParameterType
const parameters = {aztecRollupRegistry, aztecAdapterL2, } as DeploymentParameters
const { aztecAdapterL1 } = await ignition.deploy(AztecAdapterL1, {parameters:parameters});
console.log({aztecAdapterL1})