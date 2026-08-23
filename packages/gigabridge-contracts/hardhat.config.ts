import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable } from "hardhat/config";
import hardhatIgnitionViem from "@nomicfoundation/hardhat-ignition-viem";

import deployCreate2Task from "./tasks/deployCreate2.js";
import genArtifactCreate2Task from "./tasks/genArtifactCreate2.js";
import mineCreate2Task from "./tasks/mineCreate2.js";
import verifyCreate2Task from "./tasks/verifyCreate2.js";

const config: HardhatUserConfig = {
  tasks: [mineCreate2Task, genArtifactCreate2Task, deployCreate2Task, verifyCreate2Task],
  plugins: [
    hardhatToolboxViemPlugin,
    hardhatIgnitionViem,
  ],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          // do these remappings do anything? Hardhat seems to only use remappings.txt
          remappings: [],
        },

      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          // do these remappings do anything? Hardhat seems to only use remappings.txt
          remappings: [],
        },
      },
    },
    npmFilesToBuild: [
      "poseidon2-evm/src/bn254/yul/Poseidon2Yul.sol",
      // these are `public` libraries, so they get deployed separately and linked into GigaBridge
      "@warptoad/fat-imt.sol/poseidon2/FatIMTPoseidon2WriteStorage.sol",
      "@warptoad/skinny-imt.sol/poseidon2/SkinnyIMTPoseidon2WriteEvent.sol",
      "@warptoad/fat-imt.sol/poseidon2/FatIMTPoseidon2Read.sol",
      "@warptoad/skinny-imt.sol/poseidon2/SkinnyIMTPoseidon2Read.sol"
    ],
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
  },
  // Points hardhat-verify at the keystore entry, so both `npx hardhat verify` and
  // `scripts/deployToSepolia.ts` read the same key. Without this the default is an empty string.
  //   npx hardhat keystore set ETHERSCAN_API_KEY
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
  paths: {
    sources: [
      "./contracts",
    ]
  },
};

export default config;
