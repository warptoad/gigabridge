import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable } from "hardhat/config";
import hardhatIgnitionViem from "@nomicfoundation/hardhat-ignition-viem";
const config: HardhatUserConfig = {
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
          remappings: ["@aztec/core=node_modules/@aztec/l1-contracts/src/core"],
        },

      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          remappings: ["@aztec/core=node_modules/@aztec/l1-contracts/src/core",],
        },
      },
    },
    npmFilesToBuild: [
      "poseidon2-evm/src/Poseidon2Yul.sol"
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
  paths: {
    sources: [
      "./contracts",
    ]
  },
};

export default config;
