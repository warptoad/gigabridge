//aztec
import { Fr, Fq, } from "@aztec/aztec.js"

// giga-bridge-contracts
import { AztecAdapter, createPXE, deployAztec, deploySchnorrWallet, getDefaultSponsoredFPC } from "../../../giga-bridge-js/src/index.ts";
// giga-bridge-js
import { AztecAdapterL2Artifact } from "../../src/index.ts";

const AZTEC_NODE_URL = "https://aztec-testnet-fullnode.zkv.xyz";

// setup
const pxe = await createPXE({ nodeUrl: AZTEC_NODE_URL })
const timeout = 60000 * 15 // 15 min to wait for tx mined
const constructorArgs: any[] = [];
// TODO use safe keys
const secretKey = new Fr(12345678900987654321n);
const signingKey = new Fq(12345678900987654321n);
const salt = new Fr(12345678900987654321n);
const fpc = await getDefaultSponsoredFPC({pxe:pxe})

// deploy!
const { wallet: deployerWallet, tx: deployerWalletTx } = await deploySchnorrWallet({
    fpc:fpc,
    pxe:pxe,
    keys: { secretKey, signingKey, salt },
    timeout: timeout
})

const { contract: contract, tx: contractTx } = await deployAztec({
    deployerWallet: deployerWallet,
    artifact: AztecAdapterL2Artifact,
    constructorArgs: constructorArgs,
    timeout: timeout,
    pxe:pxe,
    fpc: fpc
})

//TODO finnish this
const deploymentArtifact = {
    contractArtifact: contract.artifact,
    constructorArgs: constructorArgs
}
// TODO verify it
console.log(`deployed contract at: ${contract.address}`)

const aztecAdapterL2 = await AztecAdapter.getAdapterL2({address:contract.address, client:{wallet:deployerWallet}})
const aztecAdapterL1 = await AztecAdapter.getAdapterL1({address:contract.address, wallet:deployerWallet})
const {l1Tx, l2Tx} = await AztecAdapter.updateLeaf({aztecAdapterL1:aztecAdapterL1, aztecAdapterL2:aztecAdapterL2, index:0n, value:6969n, fpc:fpc})