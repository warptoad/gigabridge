
import { AztecAdapterL2Artifact, AztecAdapterL2$Type, AztecAdapterL1$Type, AztecAdapterL1Artifact } from "../../../giga-bridge-contracts/src/index.ts"
import { AztecAddress, AztecAddressLike, Contract, FeePaymentMethod, Fr, PXE, Wallet } from "@aztec/aztec.js"
import { getDefaultSponsoredFPC } from "../utils/aztecUtils.ts"
import { sleep } from "../utils/utils.ts"
import { Address, Client, getContract, PublicClient, WalletClient } from "viem"

type AtLeastOne<T> = { [K in keyof T]: Partial<T> & Pick<T, K> }[keyof T];
//TODO make common interface / class for adapters
export class AztecAdapter {
    static bridgeTime = {
        toL2: {
            minimum: 3600000, // 1h @TODO ask aztec engineer what the timings are
            max: Infinity
        },
        toL1: {
            minimum: 3600000, // 1h @TODO ask aztec engineer what the timings are
            max: Infinity // not sure if we need this? Are there L2's that are forced to eventually settle?
        }
    }

    //TODO publicClient i think we cant do it like viem where you only use the rpc from wallet for sending transactions and the rpc in publicClient for the rest of the chain info reading
    // @DEV_UX_FEEDBACK should aztec.js have this option? is that even safe considering privacy?
    static async getAdapterL2({ address, client: { wallet, publicClient } }: { address: AztecAddress, client: { wallet: Wallet, publicClient?: "TODO" } }): Promise<AztecAdapterL2$Type> {
        //@DEV_UX_FEEDBACK Contract.at should return AztecAdapterL2Type automatically or artifact.ts should have a factory
        return (await Contract.at(address, AztecAdapterL2Artifact, wallet)) as AztecAdapterL2$Type
    }

    static getAdapterL1({ address, client: { wallet, publicClient } }: { address: Address, client: { wallet?: WalletClient, publicClient?: PublicClient } }): AztecAdapterL1$Type {
        // TODO can we do this without as any?
        // TODO do this with types
        if (wallet !== undefined) {
            return getContract({
                abi: AztecAdapterL1Artifact.abi,
                client: { public: undefined, wallet: wallet },
                address: address,
            }) as any as AztecAdapterL1$Type
        } else if (publicClient !== undefined) {
            return getContract({
                abi: AztecAdapterL1Artifact.abi,
                client: { public: publicClient, wallet: undefined },
                address: address,
            }) as any as AztecAdapterL1$Type
        } else {
            throw new Error("no client set")
        }
    }

    // this is just a tests. Most of the time a contract will call the updateLeaf not an eoa
    static async updateLeaf({ aztecAdapterL1, aztecAdapterL2, index, value, client: { wallet, publicClient }, fpc }: { fpc: FeePaymentMethod, client: { wallet: Wallet, publicClient: "TODO" }, aztecAdapterL1: AztecAdapterL1$Type, aztecAdapterL2: AztecAdapterL2$Type, index: bigint, value: bigint }) {
        aztecAdapterL2.methods.update_leaf(index, value).send({
            from: wallet.getAddress(),
            fee: {
                paymentMethod: fpc
            }
        })
        console.log(`waiting until message arrives till ${(new Date(Date.now() + this.bridgeTime.toL2.minimum)).toISOString()}`)
        await sleep(this.bridgeTime.toL2.minimum)
    }
}
