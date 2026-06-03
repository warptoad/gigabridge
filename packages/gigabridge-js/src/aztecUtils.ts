// import {
//     Fr, Fq, PXE, Contract, ContractArtifact, SponsoredFeePaymentMethod, Wallet, getContractInstanceFromInstantiationParams, createAztecNodeClient,
//     FeePaymentMethod
// } from "@aztec/aztec.js"
// import { SPONSORED_FPC_SALT } from '@aztec/constants';
// import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
// import { getSchnorrAccount } from '@aztec/accounts/schnorr';
// import { createPXEService } from "@aztec/pxe/server";
// import { createStore } from "@aztec/kv-store/lmdb";
// import { getPXEServiceConfig } from "@aztec/pxe/server";

// const AZTEC_NODE_URL = "https://aztec-testnet-fullnode.zkv.xyz";

// export async function createPXE({ nodeUrl = AZTEC_NODE_URL }: { nodeUrl: string }) {
//     const config = getPXEServiceConfig();
//     const node = createAztecNodeClient(nodeUrl);
//     const l1Contracts = await node.getL1ContractAddresses();
//     const fullConfig = { ...config, l1Contracts };

//     const store = await createStore("pxe1", {
//         dataDirectory: "store",
//         dataStoreMapSizeKb: 1e6,
//     });

//     //@DEV_UX_FEEDBACK tbh createPXEService should just default fullConfig and store to these values by it self!
//     // @ts-ignore
//     const pxe = await createPXEService(node, fullConfig, { store });
//     return pxe
// }

// export async function getDefaultSponsoredFPC({ pxe }: { pxe: PXE }) {
//     const sponsoredFPC = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT), });
//     // TODO for performance, registering this multiple time can be bad?
//     await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
//     return new SponsoredFeePaymentMethod(sponsoredFPC.address);
// }

// // timeout defaults to 1 minute in schnorrAccount.deploy().wait({ timeout: undefined })
// export async function deploySchnorrWallet(
//     { pxe, keys: { secretKey, signingKey, salt }, fpc, timeout }:
//         { pxe: PXE, keys: { secretKey: Fr, signingKey: Fq, salt: Fr }, fpc: FeePaymentMethod, timeout?: number }
// ) {
//     //@DEV_UX_FEEDBACK this is also a lott of boiler plate. Not sure where i would put it if i were aztec tho
//     const schnorrAccount = await getSchnorrAccount(pxe, secretKey, signingKey, salt);;

//     // TODO can we detect if already deployed?
//     let tx;
//     try {
//         tx = await schnorrAccount.deploy({ fee: { paymentMethod: fpc } }).wait({ timeout: timeout });
//         console.log(`deployed wallet at: ${tx.txHash}`)
//     } catch (error: unknown) {
//         if (error instanceof Error && error.message == "Invalid tx: Existing nullifier") {
//             console.log(`Schnorr account: ${schnorrAccount.getAddress()} was already deployed before.
//             The PXE error: \"Invalid tx: Existing nullifier\" is expected and a non issue.`)
//         } else {
//             throw new Error("couldn't deploy schnorr account.", { cause: error })
//         }
//     }
//     const wallet = await schnorrAccount.getWallet();
//     return { wallet, tx };
// }

// // TODO this sponsoredFPInstance is probably testnet only? We need to change this when doing mainnet?
// // timeout defaults to 1 minute in Contract.deploy().wait({ timeout: undefined })
// export async function deployAztec(
//     { deployerWallet, artifact, constructorArgs, timeout, pxe, fpc }:
//         { deployerWallet: Wallet, artifact: ContractArtifact, constructorArgs: any[], timeout?: number, pxe: PXE, fpc: FeePaymentMethod }
// ) {
//     const tx = Contract.deploy(deployerWallet, artifact, constructorArgs).send({
//         from: deployerWallet.getAddress(),
//         fee: {
//             paymentMethod: fpc
//         }
//     })
//     const contract = await tx.deployed({ timeout: timeout })
//     return { contract, tx }
// }