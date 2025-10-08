//aztec
import { createPXEClient, Fr, Fq, PXE, waitForPXE, Contract, ContractArtifact, SponsoredFeePaymentMethod, Wallet, getContractInstanceFromInstantiationParams, AccountWalletWithSecretKey, createAztecNodeClient } from "@aztec/aztec.js"
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { getSchnorrAccount } from '@aztec/accounts/schnorr';
import { createPXEService } from "@aztec/pxe/server";
import { createStore } from "@aztec/kv-store/lmdb";
import { getPXEServiceConfig } from "@aztec/pxe/server";

//local
import { MainContractArtifact as aztecAdapterL2Artifact } from "../../contracts/adapters/aztec/aztec_adapter_l2/src/artifacts/Main.ts"
const AZTEC_NODE_URL = "https://aztec-testnet-fullnode.zkv.xyz";
// const PXE_URL = "http://localhost:8080"


export async function createPXE({nodeUrl:AZTEC_NODE_URL}:{nodeUrl:string}) {
    const config = getPXEServiceConfig();
    const node = createAztecNodeClient(AZTEC_NODE_URL);
    const l1Contracts = await node.getL1ContractAddresses();
    const fullConfig = { ...config, l1Contracts };

    const store = await createStore("pxe1", {
        dataDirectory: "store",
        dataStoreMapSizeKB: 1e6,
    });

    //@DEV_UX_FEEDBACK tbh createPXEService should just default fullConfig and store to these values by it self!
    const pxe = await createPXEService(node, fullConfig, { store });
    return pxe

}

//timeout defaults to 1 minute in schnorrAccount.deploy().wait({ timeout: undefined })
export async function deploySchnorrWallet(
    { pxe, keys: { secretKey, signingKey, salt }, timeout=undefined }:
        { pxe: PXE, keys: { secretKey: Fr, signingKey: Fq, salt: Fr }, timeout?:number }
) {
    //@DEV_UX_FEEDBACK this is also a lott of boiler plate. Not sure where i would put it if i were aztec tho
    const sponsoredFPC = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT), });
    await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
    const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);
    const schnorrAccount = await getSchnorrAccount(pxe, secretKey, signingKey, salt);;
    
    // TODO can we detect if already deployed?
    let tx;
    try {
        tx = await schnorrAccount.deploy({ fee: { paymentMethod: sponsoredPaymentMethod } }).wait({ timeout: timeout });
        console.log(`deployed wallet at: ${tx.txHash}`)
    } catch (error: unknown) {
        if (error instanceof Error && error.message == "Invalid tx: Existing nullifier") {
            console.log(`Schnorr account: ${schnorrAccount.getAddress()} was already deployed before.
            The PXE error: \"Invalid tx: Existing nullifier\" is expected and a non issue.`)
        } else {
            throw new Error("couldn't deploy schnorr account.", {cause:error})
        }
    }
    const wallet = await schnorrAccount.getWallet();
    return {wallet, tx};
}

// TODO this sponsoredFPInstance is probably testnet only? We need to change this when doing mainnet?
// timeout defaults to 1 minute in Contract.deploy().wait({ timeout: undefined })
async function deployAztec(
    { deployerWallet, artifact, constructorArgs, timeout = undefined }:
        { deployerWallet: Wallet, artifact: ContractArtifact, constructorArgs: any[], timeout?: number }
) {

    const sponsoredFPInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT), });
    const sponsoredFPC = new SponsoredFeePaymentMethod(sponsoredFPInstance.address)
    const tx =  Contract.deploy(deployerWallet, artifact, constructorArgs).send({
        from: deployerWallet.getAddress(),
        fee: {
            paymentMethod: sponsoredFPC
        }
    })
    const contract = await tx.deployed({ timeout: timeout })
    return {contract, tx}
}


// setup
// TODO use safe keys
const secretKey = new Fr(12345678900987654321n);
const signingKey = new Fq(12345678900987654321n);
const salt = new Fr(12345678900987654321n);
const pxe = await createPXE({nodeUrl:AZTEC_NODE_URL})
const timeout = 60000 * 15 // 15 min
const constructorArgs:any[] = [];
// do things!
const {wallet:deployerWallet, tx:deployerWalletTx} = await deploySchnorrWallet({
        pxe, 
        keys: { secretKey, signingKey, salt }, 
        timeout:timeout 
    })  
const {contract:contract, tx:contractTx} = await deployAztec({
    deployerWallet: deployerWallet,
    artifact: aztecAdapterL2Artifact,
    constructorArgs: constructorArgs,
    timeout:timeout
})

const deploymentArtifact = {
    contractArtifact: contract.artifact,
    constructorArgs: constructorArgs

}
console.log(`deployed contract at: ${contract.address}`)