// `hardhat mine-create2` — mine salts whose CREATE2 addresses start with zeros and end how you like.
//
//   npx hardhat mine-create2                                  # the CONTRACTS list, one at a time
//   npx hardhat mine-create2 SkinnyIMTPoseidon2Read --zeros 6
//   npx hardhat mine-create2 --zeros 7 --threads 4
//   npx hardhat mine-create2 --zeros 3 --suffix 919A          # 0x000…919a
//   npx hardhat mine-create2 --zeros 3 --suffix 919A --match-case   # …919A, capital A
//   npx hardhat mine-create2 --zeros 0 --suffix c0ffee        # no zeros, just the ending
//
// `--zeros` fixes the front of the address and `--suffix` fixes the back, with the middle left to
// whatever the hash gives: `--zeros 3 --suffix 919A` looks for `0x000…919a`. The two ends are
// independent — the zeros are worth keeping because leading zero *bytes* are what makes calldata
// cheaper, while the tail is yours.
//
// Case is ignored by default, because an address is 40 hex digits and nothing more; the upper and
// lower case an explorer shows is EIP-55, a checksum computed from the address itself. `--match-case`
// mines for that too, so `--suffix 919A --match-case` only accepts an address whose checksum happens
// to capitalise the `A`. Digits have no case and cost nothing extra.
//
// Otherwise only the total number of fixed characters decides the cost — 16× per character, wherever
// it sits, since one guess either matches everywhere or it does not. Three zeros plus a
// four-character suffix is the same work as a seven-character prefix: seconds at 5, minutes at 7,
// hours at 9. Each cased letter then doubles it again, the checksum bit being a coin flip. Past ~8
// this stops being the right tool — hand `create2MiningTarget(artifact)` to create2crunch or
// createXcrunch and let a GPU do it.
//
// No network needed — a CREATE2 address is a pure function of factory, salt and init code. The
// search itself runs in `mineCreate2Worker.js`, one worker per core; this file only starts them,
// keeps score, and takes the first hit. Contracts are mined one after another, each written to
// `create2-artifacts/create2-salts.json` as `{ Contract: [salt, address] }` as soon as it lands, so
// stopping halfway keeps whatever was already found.
//
// A contract whose stored salt still produces an address matching what was asked for is left alone.
// Ask for more zeros or a different suffix to mine it again.

import { mkdir } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";

import { task } from "hardhat/config";
import { predictCreate2Address, DEFAULT_CREATE2_FACTORY } from "@warptoad/skinny-fat-imt-js/create2";

import { CONTRACTS, DEFAULT_OUT_DIR } from "./create2Config.js";
import { makeCreate2Linked, publishedLibraries, readSalts, saltsPathFor, writeSalt } from "./create2Utils.js";

/** How many attempts a worker makes between progress reports. */
const REPORT_EVERY = 5_000_000;

/** Hex characters in an address, after the `0x`. */
const ADDRESS_NIBBLES = 40;

export default task("mine-create2", "Mine CREATE2 salts for leading-zero addresses with a chosen ending")
    .addVariadicArgument({
        name: "contracts",
        description: "Contract or library names. Defaults to the CONTRACTS list in tasks/create2Config.ts",
        defaultValue: CONTRACTS,
    })
    .addOption({
        name: "zeros",
        description: "How many leading hex zeros each address must have",
        defaultValue: "5",
    })
    .addOption({
        name: "suffix",
        description: "Hex characters the address must end with, e.g. `919A`",
        defaultValue: "",
    })
    .addFlag({
        name: "matchCase",
        description: "Match --suffix letter for letter, as the checksummed address displays it",
    })
    .addOption({
        name: "threads",
        description: "Worker threads to search with. Defaults to one per core",
        defaultValue: "0",
    })
    .addOption({
        name: "outDir",
        description: "Directory holding create2-salts.json",
        defaultValue: DEFAULT_OUT_DIR,
    })
    .setInlineAction(async ({ contracts, zeros, suffix, matchCase, threads, outDir }, hre) => {
        const wanted = Number(zeros);
        if (!Number.isInteger(wanted) || wanted < 0 || wanted > ADDRESS_NIBBLES) {
            throw new Error(`--zeros must be between 0 and ${ADDRESS_NIBBLES}, got ${zeros}`);
        }
        const typed = suffix.replace(/^0x/i, "");
        if (!/^[0-9a-fA-F]*$/.test(typed)) {
            throw new Error(`--suffix must be hex characters, got ${suffix}`);
        }
        const tail = typed.toLowerCase();
        if (wanted + tail.length === 0 || wanted + tail.length > ADDRESS_NIBBLES) {
            throw new Error(
                `--zeros and --suffix together must fix between 1 and ${ADDRESS_NIBBLES} of the address's ` +
                `hex characters, got ${wanted + tail.length}`,
            );
        }

        // Both ends become one 40-character pattern, `.` for the characters nobody cares about.
        // Everything downstream works off this and never has to know which end a constraint came
        // from — matching a zero at the front is the same operation as matching a `9` at the back.
        const pattern = "0".repeat(wanted) + ".".repeat(ADDRESS_NIBBLES - wanted - tail.length) + tail;

        // A second pattern for the letters whose case was asked for, in the same 40-character frame.
        // Only `a`-`f` carry case, so digits stay wildcards however they were typed, and the zeros at
        // the front never contribute — which is why this is separate from `pattern` rather than
        // replacing it: what a nibble *is* and how it is *displayed* are two different tests.
        const casePattern = matchCase
            ? ".".repeat(ADDRESS_NIBBLES - typed.length) +
              [...typed].map((c) => (/[a-f]/i.test(c) ? c : ".")).join("")
            : ".".repeat(ADDRESS_NIBBLES);
        const casedLetters = [...casePattern].filter((c) => c !== ".").length;

        const label = `0x${"0".repeat(wanted)}…${matchCase ? typed : tail}`;
        const workerCount = Number(threads) > 0 ? Number(threads) : availableParallelism();

        await mkdir(outDir, { recursive: true });
        const mined = await readSalts(outDir);
        const published = await publishedLibraries();

        console.log(`mining ${contracts.length} contract(s) for addresses like ${label} on ${workerCount} threads`);
        // Each fixed character is one hex digit out of 16, wherever in the address it sits, so the
        // expected attempt count is 16^(number of them) — worth printing, because the difference
        // between fixing 7 characters and 9 is minutes and hours. A letter whose case was asked for
        // costs another factor of 2 on top: the checksum bit deciding it is as good as a coin flip.
        const expected = 16 ** (wanted + tail.length) * 2 ** casedLetters;
        console.log(
            `expect ~${expected.toExponential(1)} attempts per contract` +
            (casedLetters > 0 ? ` (${casedLetters} cased letter(s), doubling each)` : ""),
        );
        console.log(`factory ${DEFAULT_CREATE2_FACTORY}`);
        console.log(`salts   ${saltsPathFor(outDir)}\n`);

        for (const contract of contracts as string[]) {
            // A published library is somebody else's mining, already done and already depended on
            // by whoever links it. Re-mining it here would move it off the published address and
            // help nobody, so this only reports it — and reads the artifact while doing so, which
            // is what checks the published salt still puts those bytes at the published address.
            const external = published.get(contract);
            if (external !== undefined) {
                await external.artifact();
                const zeros = external.address.toLowerCase().slice(2).search(/[^0]/);
                console.log(`${contract.padEnd(30)} published ${external.address}  (${zeros} zeros, from ${external.package})`);
                continue;
            }

            // Freezing first is what makes mining a contract that links libraries work at all, and
            // it has to happen inside the loop: a library mined a moment ago is part of this init
            // code, so its fresh salt has to be picked up before this contract's hash is taken.
            const { initCodeHash } = await makeCreate2Linked(contract, hre.artifacts, outDir);

            // A stored salt that still lands on its stored address means the init code has not moved
            // since it was mined, so there is nothing to redo. A re-mined library moves it, which is
            // why this compares against the hash just computed rather than trusting the file.
            const [storedSalt, storedAddress] = mined[contract] ?? [];
            if (
                storedSalt !== undefined &&
                storedAddress !== undefined &&
                matchesPattern(storedAddress, pattern) &&
                matchesCase(storedAddress, casePattern) &&
                predictCreate2Address({ initCodeHash, salt: storedSalt }) === storedAddress
            ) {
                console.log(`${contract.padEnd(30)} keeping ${storedAddress}`);
                continue;
            }

            const startedAt = performance.now();
            const salt = await mine(initCodeHash, pattern, casePattern, workerCount, contract);
            const address = predictCreate2Address({ initCodeHash, salt });
            // Back through the library's own prediction, so what gets written is what deploy-create2
            // will compute rather than whatever the worker's byte fiddling produced. It comes back
            // checksummed, which is what makes the case check here a plain comparison.
            if (!matchesPattern(address, pattern) || !matchesCase(address, casePattern)) {
                throw new Error(`mined salt ${salt} gives ${address}, which does not look like ${label}`);
            }

            if (storedAddress !== undefined) console.log(`  replacing ${storedAddress}`);
            await writeSalt(outDir, contract, salt, address);
            console.log(`${contract.padEnd(30)} ${address}  (${((performance.now() - startedAt) / 1000).toFixed(1)}s)`);
            console.log(`  salt ${salt}`);
        }

        console.log(`\nwrote ${saltsPathFor(outDir)} — deploy-create2 picks these up on its own`);
    })
    .build();

/**
 * Whether an address fits a pattern, which is {@link ADDRESS_NIBBLES} characters of lowercase hex
 * and `.` wildcards, with no `0x`. The workers do this against raw bytes; this is for checking a
 * mined or stored address after the fact, where a string compare is plenty.
 */
function matchesPattern(address: string, pattern: string): boolean {
    const hex = address.toLowerCase().slice(2);
    return [...pattern].every((want, i) => want === "." || want === hex[i]);
}

/**
 * Whether a checksummed address displays the letters `--match-case` asked for, in the case it asked
 * for. Same 40-character frame as {@link matchesPattern}, but compared without lowercasing — which
 * only means anything against an EIP-55 address, where the case is the checksum. An all-wildcard
 * pattern, which is what no `--match-case` produces, passes everything.
 */
function matchesCase(address: string, casePattern: string): boolean {
    const hex = address.slice(2);
    return [...casePattern].every((want, i) => want === "." || want === hex[i]);
}

/**
 * Runs `workerCount` searches in parallel and resolves with the first salt any of them finds.
 *
 * `pattern` is what the address has to look like, in the form {@link matchesPattern} describes, and
 * `casePattern` how it has to be displayed, as {@link matchesCase} describes.
 */
async function mine(
    initCodeHash: `0x${string}`,
    pattern: string,
    casePattern: string,
    workerCount: number,
    contract: string,
): Promise<`0x${string}`> {
    const startedAt = performance.now();
    let tried = 0;

    const workers = Array.from({ length: workerCount }, () =>
        new Worker(new URL("./mineCreate2Worker.js", import.meta.url), {
            workerData: {
                factory: DEFAULT_CREATE2_FACTORY,
                initCodeHash,
                pattern,
                casePattern,
                reportEvery: REPORT_EVERY,
            },
        }),
    );

    // First hit wins; everything else is torn down in the `finally`. Workers search until they find
    // something, so nothing here gives up — a pattern nobody will ever hit just keeps printing rates
    // until Ctrl-C, which is why the expected attempt count is printed before any of this starts.
    return new Promise<`0x${string}`>((resolve, reject) => {
        for (const worker of workers) {
            worker.on("error", reject);
            worker.on("message", (message) => {
                if (message.salt !== undefined) {
                    resolve(message.salt);
                } else {
                    tried += message.tried;
                    const seconds = (performance.now() - startedAt) / 1000;
                    console.log(`  ${contract}: ${tried.toLocaleString()} tried, ${Math.round(tried / seconds).toLocaleString()}/s`);
                }
            });
        }
    }).finally(() => Promise.all(workers.map((worker) => worker.terminate())));
}
