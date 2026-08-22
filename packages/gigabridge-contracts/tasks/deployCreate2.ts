// `hardhat deploy-create2` — deploy the frozen CREATE2 artifacts.
//
//   npx hardhat deploy-create2 --network sepolia                      # the CONTRACTS list
//   npx hardhat deploy-create2 SkinnyIMTPoseidon2Read --network sepolia
//   npx hardhat deploy-create2 --out-dir deployments --network sepolia
//
// Run `gen-artifact-create2` first — this task only reads the artifacts it wrote, never Hardhat's
// own, so what lands on chain is exactly what was frozen, published and verified. Salts come from
// `create2-salts.json` in the same directory unless `--salt` says otherwise.
//
// Secrets come from Hardhat's keystore via `configVariable` in hardhat.config.ts:
//   npx hardhat keystore set SEPOLIA_RPC_URL
//   npx hardhat keystore set SEPOLIA_PRIVATE_KEY
//
// Sends go out back to back and are then waited on together, so the batch costs about one block
// rather than one block each. Afterwards it settles for `--finality` blocks (default 2) before
// handing over to `verify-create2`, which is a separate task so a flaky explorer never means
// redeploying — and so it can be re-run on its own.
//
// On a local chain that only mines when it receives a transaction, pass `--finality none`; waiting
// for more blocks on an idle node never returns.

import { readFile } from "node:fs/promises";

import { task } from "hardhat/config";
import {
    sendCreate2,
    confirmCreate2,
    predictCreate2Address,
    DEFAULT_CREATE2_FACTORY,
    type Create2Artifact,
} from "@warptoad/skinny-fat-imt-js/create2";

import { CONTRACTS, DEFAULT_OUT_DIR } from "./create2Config.js";
import { artifactPathFor, resolveSalts } from "./create2Utils.js";

export default task("deploy-create2", "Deploy the frozen CREATE2 artifacts")
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
    .addOption({
        name: "finality",
        description: "How long to settle before verifying: a block count, or `safe` / `finalized` / `none`",
        defaultValue: "2",
    })
    .setInlineAction(async ({ contracts, salt, outDir, finality }, hre) => {
        const salts = await resolveSalts(contracts, salt, outDir);
        const { checkpoint, confirmations } = parseFinality(finality);

        const { viem, networkName } = await hre.network.create();
        const publicClient = await viem.getPublicClient();
        const [wallet] = await viem.getWalletClients();

        console.log(`network ${networkName} (chain ${await publicClient.getChainId()})`);
        console.log(`deployer ${wallet.account.address}`);
        console.log(`factory  ${DEFAULT_CREATE2_FACTORY}`);
        console.log(`artifacts <- ${outDir}/\n`);

        // --- 1. Read the frozen artifacts --------------------------------------------
        // Straight off disk, never through makeCreate2: deploying what `gen-artifact-create2` wrote
        // is the whole point, and a recompile between the two would otherwise silently move every
        // address. No chain access either, so all at once.
        const frozen = await Promise.all(
            contracts.map(async (contract: string) => {
                const path = artifactPathFor(outDir, contract);
                const raw = await readFile(path, "utf8").catch(() => {
                    throw new Error(`no artifact at ${path} — run \`npx hardhat gen-artifact-create2 ${contract}\` first`);
                });
                const artifact = JSON.parse(raw) as Create2Artifact;
                const address = predictCreate2Address({
                    initCodeHash: artifact.initCodeHash,
                    salt: salts.get(contract)!,
                });
                console.log(`loaded ${contract.padEnd(30)} -> ${address}`);
                return { contract, artifact, address };
            }),
        );

        // Each artifact records the library addresses baked into its init code. If this run would
        // put one of those libraries somewhere else — a stale artifact, or a `--salt` that moved
        // every contract including the libraries — the deployment succeeds and is permanently
        // broken, because every call into the library goes to the address already inside the
        // bytecode. Libraries not in this run are somebody else's problem; only a contradiction
        // between what is about to be sent and what was frozen is caught here.
        const planned = new Map(frozen.map(({ contract, address }) => [contract, address.toLowerCase()]));
        const contradictions = frozen.flatMap(({ contract, artifact }) =>
            Object.entries(artifact.linkedLibraries ?? {})
                .filter(([library, baked]) => {
                    const address = planned.get(library);
                    return address !== undefined && address !== baked.toLowerCase();
                })
                .map(([library, baked]) => `  ${contract} expects ${library} at ${baked}, this run puts it at ${planned.get(library)}`),
        );
        if (contradictions.length > 0) {
            throw new Error(
                `library addresses do not match what was frozen:\n${contradictions.join("\n")}\n` +
                "Re-run `gen-artifact-create2` with the salts you are deploying with, or drop `--salt`.",
            );
        }

        // --- 2. Deploy ---------------------------------------------------------------
        // Partition first: a contract already on chain must not consume a nonce, or the sends
        // after it would queue behind a gap the node never fills.
        const codes = await Promise.all(frozen.map((f) => publicClient.getCode({ address: f.address })));
        const isMissing = (code: string | undefined) => code === undefined || code === "0x";
        const pending = frozen.filter((_, i) => isMissing(codes[i]));

        for (const [i, { contract }] of frozen.entries()) {
            if (!isMissing(codes[i])) console.log(`already deployed: ${contract}`);
        }

        if (pending.length === 0) {
            console.log("\nnothing to deploy — run `npx hardhat verify-create2` next");
            return;
        }

        // One nonce read, then consecutive values assigned by hand. Left to the wallet, every
        // concurrent send would read the same pending nonce and collide.
        const baseNonce = await publicClient.getTransactionCount({
            address: wallet.account.address,
            blockTag: "pending",
        });
        console.log(`\nsending ${pending.length} deployments from nonce ${baseNonce}`);

        // Sends go out one after another, but each only waits for the node to accept the
        // transaction — a single fast round trip. Firing them truly in parallel breaks on any node
        // without mempool queueing for future nonces (Hardhat's own network rejects a nonce that
        // arrives before its predecessor), and the ordering costs nothing: the slow part is the
        // block, and all of those are waited on together below.
        const sent: { contract: string; address: `0x${string}`; transactionHash: `0x${string}` }[] = [];
        let failures = 0;

        for (const [i, { contract, artifact }] of pending.entries()) {
            try {
                const result = await sendCreate2({
                    artifact,
                    salt: salts.get(contract)!,
                    walletClient: wallet,
                    publicClient,
                    nonce: baseNonce + i,
                });
                console.log(`  sent   ${contract.padEnd(30)} ${result.transactionHash}`);
                sent.push({ contract, address: result.address, transactionHash: result.transactionHash! });
            } catch (error) {
                failures += 1;
                console.log(`  FAILED ${contract.padEnd(30)} ${(error as Error).message.split("\n")[0]}`);
            }
        }

        // Now the waiting, all at once — one block's latency for the whole batch rather than per
        // deployment. `confirmations` rides along here rather than being a separate polling pass
        // afterwards: viem's `waitForTransactionReceipt` already waits for extra blocks, and
        // watches for the transaction being replaced while it does.
        console.log(`\nwaiting for ${sent.length} deployment transactions (${confirmations} confirmations)`);
        const confirmed = await Promise.allSettled(
            sent.map(({ address, transactionHash }) =>
                confirmCreate2({ address, transactionHash, publicClient, confirmations, timeout: 300_000 }),
            ),
        );
        for (const [i, outcome] of confirmed.entries()) {
            const { contract, address } = sent[i];
            if (outcome.status === "fulfilled") {
                console.log(`  ok     ${contract.padEnd(30)} ${address}`);
            } else {
                failures += 1;
                console.log(`  FAILED ${contract.padEnd(30)} ${(outcome.reason as Error).message.split("\n")[0]}`);
            }
        }

        // --- 3. Settle ------------------------------------------------------------------
        // Only checkpoints need a separate pass; block counts were handled above.
        if (checkpoint !== undefined) await waitForCheckpoint(publicClient, checkpoint);

        console.log(`\nnext: npx hardhat verify-create2 --out-dir ${outDir} --network ${networkName}`);
        if (failures > 0) throw new Error(`${failures} of ${pending.length} deployments failed`);
    })
    .build();

/**
 * Turns `--finality` into either a confirmation count or a consensus checkpoint to wait for.
 *
 * A block count is the sensible default, and viem's `waitForTransactionReceipt` already knows how
 * to wait for one, so it costs nothing extra.
 */
function parseFinality(finality: string): { checkpoint?: "safe" | "finalized"; confirmations: number } {
    if (finality === "safe" || finality === "finalized") return { checkpoint: finality, confirmations: 1 };
    if (finality === "none") return { confirmations: 1 };

    const confirmations = Number(finality);
    if (!Number.isInteger(confirmations) || confirmations < 1) {
        throw new Error(`--finality must be a block count >= 1, \`safe\`, \`finalized\` or \`none\`, got ${finality}`);
    }
    return { confirmations };
}

/**
 * Waits for a consensus checkpoint to reach the current head.
 *
 * These are not confirmation counts. On a stock node `safe` is the latest *justified* block, which
 * only advances at epoch boundaries (32 slots, 6.4 minutes), so this costs 6-13 minutes — rarely
 * worth it here, since a CREATE2 address is a pure function of its init code and a re-org that
 * dropped a deployment could simply be replayed to the same address with the same bytecode.
 *
 * It is also already the right call for the Fast Confirmation Rule. FCR is a consensus-client
 * opt-in (`--enable-fast-confirmation`), off by default everywhere, and where it is on it reuses
 * this same tag: `safe` then returns the last fast-confirmed block, typically within one slot
 * rather than two epochs. Nothing changes here — point this at an RPC whose consensus client runs
 * FCR and `--finality safe` becomes fast on its own.
 */
async function waitForCheckpoint(
    publicClient: {
        getBlockNumber(): Promise<bigint>;
        getBlock(args: { blockTag: "safe" | "finalized" }): Promise<{ number: bigint | null }>;
    },
    checkpoint: "safe" | "finalized",
    timeoutMs = 1_800_000,
): Promise<void> {
    const target = await publicClient.getBlockNumber();
    const deadline = Date.now() + timeoutMs;
    console.log(`
waiting for a ${checkpoint} block at or past ${target} (epoch checkpoints — minutes, not seconds)`);

    while (Date.now() < deadline) {
        let head: bigint | null;
        try {
            head = (await publicClient.getBlock({ blockTag: checkpoint })).number;
        } catch {
            // Local networks and some L2s have no such tag, and no finality to wait for either.
            console.log(`  chain has no \`${checkpoint}\` block tag — not waiting`);
            return;
        }
        if (head !== null && head >= target) {
            console.log(`  ${checkpoint} block ${head} — settled`);
            return;
        }
        console.log(`  ${checkpoint} ${head ?? "?"} < ${target}`);
        await new Promise((r) => setTimeout(r, 12_000));
    }
    throw new Error(`timed out waiting for a ${checkpoint} block at or past ${target}`);
}
