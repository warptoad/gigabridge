// `hardhat gen-artifact-create2` — freeze contracts into `<Contract>.create2.json` artifacts.
//
//   npx hardhat gen-artifact-create2                          # the CONTRACTS list
//   npx hardhat gen-artifact-create2 SkinnyIMTPoseidon2Read
//   npx hardhat gen-artifact-create2 --out-dir somewhere-else
//
// Split out from `deploy-create2` because the two halves need completely different things: this one
// needs Hardhat and a compile but no network, and deploying needs a network but only the JSON. So
// freezing happens once, and the artifacts it writes are what gets committed, published, deployed to
// every chain, and verified — always the same bytes.
//
// Whichever build profile was compiled last is the one that gets frozen; Hardhat keeps a single
// `artifacts/` tree, not one per profile.
//
// A published library is copied in rather than rebuilt, and its salt is copied into
// `create2-salts.json` alongside it. Nothing downstream needs that entry — the salt is read from the
// package either way — but it leaves one directory that says where every artifact in it lands, which
// is the same shape a package publishes.

import { mkdir, writeFile } from "node:fs/promises";

import { task } from "hardhat/config";
import type { Hex } from "viem";
import { predictCreate2Address } from "@warptoad/skinny-fat-imt-js/create2";

import { CONTRACTS, DEFAULT_OUT_DIR } from "./create2Config.js";
import {
    artifactPathFor,
    makeCreate2Linked,
    publishedLibraries,
    resolveSalts,
    saltsPathFor,
    writeSalts,
} from "./create2Utils.js";

export default task("gen-artifact-create2", "Freeze contracts into CREATE2 artifacts")
    .addVariadicArgument({
        name: "contracts",
        description: "Contract or library names. Defaults to the CONTRACTS list in tasks/create2Config.ts",
        defaultValue: CONTRACTS,
    })
    .addOption({
        name: "salt",
        description: "32-byte salt to predict addresses with. Defaults to the mined salt per contract",
        defaultValue: "",
    })
    .addOption({
        name: "outDir",
        description: "Directory for the frozen <Contract>.create2.json artifacts",
        defaultValue: DEFAULT_OUT_DIR,
    })
    .setInlineAction(async ({ contracts, salt, outDir }, hre) => {
        const salts = await resolveSalts(contracts, salt, outDir);
        const published = await publishedLibraries();
        await mkdir(outDir, { recursive: true });
        console.log(`artifacts -> ${outDir}/\n`);

        // Salts for the libraries copied in below. They come from their packages, so nothing here
        // needs them written down — this is for the record: with them, `outDir` says where every
        // artifact next to it lands, and is a publishable package directory in its own right.
        const copiedSalts: Record<string, [Hex, Hex]> = {};

        // No chain access anywhere here, so all at once.
        await Promise.all(
            contracts.map(async (contract: string) => {
                // A published library is copied through rather than rebuilt. Its bytes are already
                // frozen — recompiling them here would be a different build, and everything linking
                // it has the published address baked in. Copying keeps `deploy-create2` and
                // `verify-create2` working off one directory, whatever the source.
                const external = published.get(contract);
                const artifact = external === undefined
                    ? await makeCreate2Linked(contract, hre.artifacts, outDir)
                    : await external.artifact();

                await writeFile(artifactPathFor(outDir, contract), `${JSON.stringify(artifact, null, 2)}\n`);
                const address = predictCreate2Address({
                    initCodeHash: artifact.initCodeHash,
                    salt: salts.get(contract)!,
                });
                if (external !== undefined) copiedSalts[contract] = [external.salt, address];
                console.log(`${external === undefined ? "froze " : "copied"} ${contract.padEnd(30)} -> ${address}`);
            }),
        );

        // One write for the batch — `writeSalt` per library would be concurrent read-modify-writes
        // of the same file, and all but the last would be lost.
        const copied = Object.keys(copiedSalts).length;
        if (copied > 0) {
            await writeSalts(outDir, copiedSalts);
            console.log(`\nrecorded ${copied} published salt(s) in ${saltsPathFor(outDir)}`);
        }

        console.log(`\nnext: npx hardhat deploy-create2 --out-dir ${outDir} --network <network>`);
    })
    .build();
