//aztec
import { createPXEClient, Fr, Fq, PXE, waitForPXE, Contract, ContractArtifact, SponsoredFeePaymentMethod, Wallet, getContractInstanceFromInstantiationParams, AccountWalletWithSecretKey } from "@aztec/aztec.js"
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { getSchnorrAccount } from '@aztec/accounts/schnorr';

//local
import { MainContractArtifact as aztecAdapterL2Artifact } from "../../contracts/adapters/aztec/aztec_adapter_l2/src/artifacts/Main.ts"
const AZTEC_NODE_URL = "https://aztec-testnet-fullnode.zkv.xyz";
const PXE_URL = "http://localhost:8080"

export async function deploySchnorrWallet(
    { pxe, keys: { secretKey, signingKey, salt } }:
        { pxe: PXE, keys: { secretKey: Fr, signingKey: Fq, salt: Fr } }
): Promise<AccountWalletWithSecretKey> {

    const sponsoredFPC = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT), });
    await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
    const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);
    const schnorrAccount = await getSchnorrAccount(pxe, secretKey, signingKey, salt);;
    const tx = await schnorrAccount.deploy({ fee: { paymentMethod: sponsoredPaymentMethod } }).wait({ timeout: 120000 });
    console.log(`deployed wallet at: ${tx.txHash}`)
    const wallet = await schnorrAccount.getWallet();
    return wallet;
}

// TODO this sponsoredFPInstance is probably testnet only? We need to change this when doing mainnet?
async function deployAztec(
    { deployerWallet, artifact, constructorArgs, timeout = undefined }:
        { deployerWallet: Wallet, artifact: ContractArtifact, constructorArgs: any[], timeout?: number }
) {

    const sponsoredFPInstance = await getContractInstanceFromInstantiationParams(SponsoredFPCContract.artifact, { salt: new Fr(SPONSORED_FPC_SALT), });
    const sponsoredFPC = new SponsoredFeePaymentMethod(sponsoredFPInstance.address)
    return await Contract.deploy(deployerWallet, artifact, constructorArgs).send({
        from: deployerWallet.getAddress(),
        fee: {
            paymentMethod: sponsoredFPC
        }
    }).deployed({ timeout: timeout })
}


// TODO use safe keys
const secretKey = new Fr(12345678900987654321n);
const signingKey = new Fq(12345678900987654321n);
const salt = new Fr(12345678900987654321n);

const pxe = createPXEClient(PXE_URL);
await waitForPXE(pxe);
const deployerWallet = await deploySchnorrWallet({ pxe, keys: { secretKey, signingKey, salt } })
const contract = await deployAztec({
    deployerWallet: deployerWallet,
    artifact: aztecAdapterL2Artifact,
    constructorArgs: []
})
console.log(`deployed contract at: ${contract.address}`)