// `hardhat verify-create2` — verify already-deployed CREATE2 artifacts on Etherscan and Sourcify.
//
//   npx hardhat verify-create2 --network sepolia
//   npx hardhat verify-create2 SkinnyIMTPoseidon2Read --network sepolia
//
//   npx hardhat keystore set ETHERSCAN_API_KEY
//
// Split out from `deploy-create2` so an explorer hiccup never costs a redeployment, and so this
// can be re-run on its own until it sticks. It reads the artifacts off disk and works out each
// address from the frozen init code hash plus the salt, so it never needs the compiler.
//
// Deliberately serial: the explorers rate-limit and misbehave under concurrent submissions.

import { readFile } from "node:fs/promises";

import { task } from "hardhat/config";
import type { Address } from "viem";
import {
    predictCreate2Address,
    matchesOnchainBytecode,
    verifyOnEtherscan,
    verifyOnSourcify,
    type Create2Artifact,
} from "@warptoad/skinny-fat-imt-js/create2";

import { CONTRACTS, DEFAULT_OUT_DIR } from "./create2Config.js";
import { artifactPathFor, resolveSalts } from "./create2Utils.js";

export default task("verify-create2", "Verify deployed CREATE2 artifacts on Etherscan and Sourcify")
    .addVariadicArgument({
        name: "contracts",
        description: "Contract or library names. Defaults to the CONTRACTS list in tasks/create2Config.ts",
        defaultValue: CONTRACTS,
    })
    .addOption({
        name: "salt",
        description: "32-byte salt for every contract. Defaults to the mined salt, else DEFAULT_SALT",
        defaultValue: "",
    })
    .addOption({
        name: "outDir",
        description: "Directory holding the frozen <Contract>.create2.json artifacts",
        defaultValue: DEFAULT_OUT_DIR,
    })
    .setInlineAction(async ({ contracts, salt, outDir }, hre) => {
        const salts = await resolveSalts(contracts, salt, outDir);

        const { viem, networkName } = await hre.network.create();
        const publicClient = await viem.getPublicClient();
        const chainId = await publicClient.getChainId();

        // Resolved on first use so a run that verifies nothing never prompts for the keystore.
        let pendingApiKey: Promise<string> | undefined;
        const etherscanApiKey = () => (pendingApiKey ??= hre.config.verify.etherscan.apiKey.get());

        console.log(`network ${networkName} (chain ${chainId})`);
        console.log(`artifacts <- ${outDir}/\n`);

        const summary: { contract: string; address?: Address; status: string }[] = [];

        for (const contract of contracts) {
            const states: string[] = [];
            let address: Address | undefined;
            try {
                const path = artifactPathFor(outDir, contract);
                const artifact = JSON.parse(await readFile(path, "utf8")) as Create2Artifact;

                address = predictCreate2Address({
                    initCodeHash: artifact.initCodeHash,
                    salt: salts.get(contract)!,
                });

                // Nothing to verify if it was never deployed, and the explorers would only give a
                // confusing answer.
                const onchain = await publicClient.getCode({ address });
                if (onchain === undefined || onchain === "0x") {
                    console.log(`  ${contract.padEnd(30)} not deployed at ${address}`);
                    summary.push({ contract, address, status: "not deployed" });
                    continue;
                }

                // Confirms the deployment matches the artifact before asking anyone else. Not a
                // plain compare — solc patches a library's own address into its runtime code.
                states.push(matchesOnchainBytecode(artifact, onchain, address) ? "bytecode:ok" : "bytecode:MISMATCH");

                const apiKey = await etherscanApiKey();
                if (apiKey === "") {
                    states.push("etherscan:skipped");
                } else {
                    const etherscan = await verifyOnEtherscan({ artifact, address, chainId, apiKey });
                    states.push(`etherscan:${etherscan.outcome}`);
                    if (etherscan.outcome === "failed") states.push(`(${etherscan.message})`);
                }

                const sourcify = await verifyOnSourcify({ artifact, address, chainId });
                // `exact_match` means the metadata hash matched too, not just the runtime code.
                states.push(`sourcify:${sourcify.match ?? sourcify.outcome}`);
            } catch (error) {
                states.push(`errored: ${(error as Error).message.split("\n")[0]}`);
            }

            console.log(`  ${contract.padEnd(30)} ${states.join(" ")}`);
            summary.push({ contract, address, status: states.join(" ") });
        }

        const width = Math.max(...summary.map((s) => s.contract.length));
        console.log("\nsummary");
        for (const { contract, address, status } of summary) {
            console.log(`  ${contract.padEnd(width)}  ${address ?? "-".padEnd(42)}  ${status}`);
        }

        const bad = summary.filter(
            (s) =>
                s.status.includes("MISMATCH") ||
                s.status.includes("errored") ||
                s.status.includes("failed") ||
                s.status === "not deployed",
        );
        if (bad.length > 0) throw new Error(`${bad.length} of ${summary.length} contracts did not verify`);
    })
    .build();
