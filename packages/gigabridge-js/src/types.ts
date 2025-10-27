import { Account, Address, Chain, Client, GetContractParameters, GetContractReturnType, PublicClient, Transport, WalletClient} from "viem"
import { GigaBridge$Type }  from "../../gigabridge-contracts/artifacts/contracts/gigabridge/GigaBridge.sol/artifacts.js"

export type KeyedClient =
  | {
      public?: PublicClient;
      wallet: WalletClient;
    }
  | {
      public: PublicClient;
      wallet?: WalletClient;
    };

export type GigaBridgeContractWithWalletClient = GetContractReturnType<GigaBridge$Type["abi"], Required<{public?: PublicClient; wallet: WalletClient;}>>
export type GigaBridgeContract = GetContractReturnType<GigaBridge$Type["abi"], Required<{public?: PublicClient;wallet?: WalletClient;}>>