// How the `*-create2` tasks find, read, freeze and salt artifacts. The things worth changing are in
// `create2Config.ts`; this is the machinery behind them.
//
// The salt matters to all four tasks. Deploy needs it to send to the right address; verify needs it
// to work out which address to point the explorers at, since a `Create2Artifact` records the
// bytecode but not where it was put.
//
// Salts live in `<out-dir>/create2-salts.json`, written by `mine-create2`. That file is a
// convenience, not a source of truth: an entry is only valid for the init code it was mined against,
// so a recompile with different settings or a dependency bump makes it stale, and the address moves.
// Nothing checks this at deploy time — `mine-create2` re-checks its own entries, and that is all.
//
// Libraries are the exception, and mostly do not appear in that file at all. A package listed in
// `LIBRARY_PACKAGES` ships its own frozen artifacts and the salts they were mined against, and those
// win over anything local — see {@link publishedLibraries}. What that buys is a single address per
// library across every project and every chain, rather than one per person who compiled it.

import { readFile, writeFile } from "node:fs/promises";

import type { ArtifactManager } from "hardhat/types/artifacts";
import { isHex, size, type Address, type Hex } from "viem";
import { makeCreate2, predictCreate2Address, type Create2Artifact } from "@warptoad/skinny-fat-imt-js/create2";

import { DEFAULT_OUT_DIR, DEFAULT_SALT, LIBRARY_PACKAGES } from "./create2Config.js";

export const artifactPathFor = (outDir: string, contract: string) => `${outDir}/${contract}.create2.json`;

export const saltsPathFor = (outDir: string) => `${outDir}/create2-salts.json`;

/** `{ [contract]: [salt, address] }` as `mine-create2` left it. No file yet means no mined salts. */
export async function readSalts(outDir: string): Promise<Record<string, [Hex, Hex]>> {
    return JSON.parse(await readFile(saltsPathFor(outDir), "utf8").catch(() => "{}"));
}

/** Records one salt, keeping every other entry. */
export async function writeSalt(outDir: string, contract: string, salt: Hex, address: Hex): Promise<void> {
    return writeSalts(outDir, { [contract]: [salt, address] });
}

/**
 * Records several salts at once, keeping every other entry.
 *
 * A batch rather than a loop of {@link writeSalt} because each one of those is a read-modify-write
 * of the whole file: run concurrently, they read the same file and the last writer wins, dropping
 * everything the others added.
 */
export async function writeSalts(outDir: string, entries: Record<string, [Hex, Hex]>): Promise<void> {
    const salts = Object.assign(await readSalts(outDir), entries);
    await writeFile(saltsPathFor(outDir), `${JSON.stringify(salts, null, 2)}\n`);
}

/**
 * Which salt each contract gets: a published library's own salt first, then an explicit `--salt`,
 * then whatever `mine-create2` stored, then `DEFAULT_SALT`.
 *
 * A published salt beating `--salt` is deliberate. It is the only salt that puts those exact
 * published bytes at the published address, and every contract linking the library already has that
 * address inside its init code — so there is no such thing as deploying it somewhere else and still
 * having anything work.
 */
export async function resolveSalts(
    contracts: string[],
    fallback: string,
    outDir: string,
): Promise<Map<string, Hex>> {
    const mined = await readSalts(outDir);
    const published = await publishedLibraries();
    const salts = new Map<string, Hex>();
    for (const contract of contracts) {
        const salt = (published.get(contract)?.salt || fallback || mined[contract]?.[0] || DEFAULT_SALT) as Hex;
        if (!isHex(salt) || size(salt) !== 32) {
            throw new Error(`salt for ${contract} must be 32 bytes of hex, got ${salt}`);
        }
        salts.set(contract, salt);
    }
    return salts;
}

/** One library a `LIBRARY_PACKAGES` package has already frozen, mined and published. */
export interface PublishedLibrary {
    /** Which package it came from, for saying so in errors. */
    package: string;
    salt: Hex;
    address: Address;
    /** The frozen artifact, read and checked on first use. These run to hundreds of KB each. */
    artifact: () => Promise<Create2Artifact>;
}

let libraries: Promise<Map<string, PublishedLibrary>> | undefined;

/**
 * Everything `LIBRARY_PACKAGES` publishes, keyed by contract name.
 *
 * A package's `create2-salts.json` is the index: it offers exactly what it has mined a salt for.
 * Read once per process, and only the salts — the artifacts themselves stay on disk until something
 * actually links or deploys one.
 */
export function publishedLibraries(): Promise<Map<string, PublishedLibrary>> {
    return (libraries ??= readPublishedLibraries());
}

async function readPublishedLibraries(): Promise<Map<string, PublishedLibrary>> {
    const found = new Map<string, PublishedLibrary>();

    for (const packageName of LIBRARY_PACKAGES) {
        // Resolved through the package's own `package.json` export, so this finds the files wherever
        // the installer put them — pnpm's content-addressed store included — rather than assuming a
        // shape for node_modules. The layout inside is this project's own, named by the same helpers
        // that write it, so a directory produced here reads back without a second convention.
        const dir = new URL(`./${DEFAULT_OUT_DIR}/`, import.meta.resolve(`${packageName}/package.json`));
        const salts: Record<string, [Hex, Address]> = JSON.parse(
            await readFile(new URL(saltsPathFor("."), dir), "utf8"),
        );

        for (const [name, [salt, address]] of Object.entries(salts)) {
            let reading: Promise<Create2Artifact> | undefined;
            const url = new URL(artifactPathFor(".", name), dir);
            found.set(name, {
                package: packageName,
                salt,
                address,
                artifact: () => (reading ??= readPublishedArtifact(url, packageName, name, salt, address)),
            });
        }
    }

    return found;
}

async function readPublishedArtifact(
    url: URL,
    packageName: string,
    name: string,
    salt: Hex,
    address: Address,
): Promise<Create2Artifact> {
    const artifact = JSON.parse(await readFile(url, "utf8")) as Create2Artifact;

    // The published salt and the published bytes have to agree, or the address everyone links
    // against is not where those bytes land. Cheap to check, and there is no recovering from it
    // here — the package would have to be fixed.
    const predicted = predictCreate2Address({ initCodeHash: artifact.initCodeHash, salt });
    if (predicted.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
            `${packageName} lists ${name} at ${address}, but its artifact and salt give ${predicted}`,
        );
    }
    return artifact;
}

/**
 * Freezes a contract, filling in the addresses of any libraries it links against.
 *
 * solc compiles a call to a `public` library into a DELEGATECALL to a separate deployment, and
 * leaves a `__$…$__` placeholder where that address goes. So the address is part of the calling
 * contract's init code, and therefore part of *its* address: re-mine a library and everything above
 * it moves. Nothing has to be on chain first, though — a CREATE2 address is knowable in advance, so
 * each library is frozen too and its address predicted from its own salt.
 *
 * A published library is taken as published — its own artifact and its own salt. Anything else is
 * frozen from this project's compile, with a salt from `create2-salts.json` or `DEFAULT_SALT`; an
 * explicit `--salt` deliberately does not reach either, since it is asking for one contract to land
 * somewhere, not for its whole dependency tree to move.
 */
export async function makeCreate2Linked(
    contract: string,
    artifacts: ArtifactManager,
    outDir: string,
): Promise<Create2Artifact> {
    return freeze(contract, artifacts, await readSalts(outDir), await publishedLibraries(), new Map());
}

async function freeze(
    contract: string,
    artifacts: ArtifactManager,
    mined: Record<string, [Hex, Hex]>,
    published: Map<string, PublishedLibrary>,
    frozen: Map<string, Create2Artifact>,
): Promise<Create2Artifact> {
    const already = frozen.get(contract);
    if (already !== undefined) return already;

    const { linkReferences } = await artifacts.readArtifact(contract);
    const libraries: Record<string, Address> = {};

    for (const [sourceName, names] of Object.entries(linkReferences ?? {})) {
        for (const libraryName of Object.keys(names)) {
            // Keyed the way the linker looks it up first. The source name here is solc's, which for
            // a dependency carries an `npm/…@version` prefix that `readArtifact` does not accept —
            // hence the bare name for reading and the qualified one for linking.
            const identifier = `${sourceName}:${libraryName}`;
            const external = published.get(libraryName);

            if (external !== undefined) {
                const artifact = await external.artifact();
                // That prefix is worth something here: it names the exact npm version solc compiled
                // against, so comparing identifiers catches a published library built from a
                // different release of the package than this contract is calling. The bytes would
                // deploy fine and the selectors might even line up.
                if (artifact.contractIdentifier !== identifier) {
                    throw new Error(
                        `${contract} links ${identifier}, but ${external.package} publishes ` +
                        `${artifact.contractIdentifier}. Line the versions up, or take ${external.package} ` +
                        "out of LIBRARY_PACKAGES to build the library here instead.",
                    );
                }
                libraries[identifier] = external.address;
                continue;
            }

            const library = await freeze(libraryName, artifacts, mined, published, frozen).catch((cause) => {
                throw new Error(`${contract} links ${identifier}, which could not be frozen`, { cause });
            });
            libraries[identifier] = predictCreate2Address({
                initCodeHash: library.initCodeHash,
                salt: mined[libraryName]?.[0] ?? DEFAULT_SALT,
            });
        }
    }

    const artifact = await makeCreate2(contract, { libraries });
    frozen.set(contract, artifact);
    return artifact;
}
