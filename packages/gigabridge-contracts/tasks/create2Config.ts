// The knobs for the `mine-create2`, `gen-artifact-create2`, `deploy-create2` and `verify-create2`
// tasks: which contracts they act on, where the frozen artifacts go, where libraries come from, and
// what salt to fall back on. Everything in this file is meant to be edited.
//
// The machinery that acts on it — reading and writing salts, freezing artifacts, resolving published
// libraries — is in `create2Utils.ts`, and nothing there should need changing.

import type { Hex } from "viem";

/**
 * What the tasks act on when no contract is named on the command line.
 *
 * Libraries first. GigaBridge calls all four as `public` libraries, which means they are separate
 * deployments whose addresses are baked into its init code, so they have to be settled before it.
 * They are published — see {@link LIBRARY_PACKAGES} — so nothing here mines or freezes them, but
 * they are still listed: somebody has to deploy them on a chain that does not have them yet, and
 * that is `deploy-create2`'s job.
 */
export const CONTRACTS = [
    "FatIMTPoseidon2Read",
    "FatIMTPoseidon2WriteStorage",
    "SkinnyIMTPoseidon2Read",
    "SkinnyIMTPoseidon2WriteEvent",
    "GigaBridge",
];

/**
 * Packages that publish frozen CREATE2 artifacts together with the salts they were mined against.
 *
 * A library found in one of these is never compiled, frozen or mined here. The published bytes are
 * what gets deployed, at the address its publisher already mined, on every chain — which is the
 * whole point of the exercise: everyone linking that library ends up pointing at the same address.
 * Empty this list and every library goes back to being built and mined from this project's compile.
 *
 * A package qualifies by exporting `./package.json` — that is what locates it, so nothing here
 * depends on the shape of node_modules — and by having this next to it:
 *
 *     <package root>/
 *       package.json
 *       create2-artifacts/
 *         create2-salts.json          { "<Contract>": ["<32-byte salt>", "<address>"] }
 *         <Contract>.create2.json     one `Create2Artifact`, i.e. `makeCreate2()` serialized
 *
 * Which is exactly what `mine-create2` and `gen-artifact-create2` write into `--out-dir` here — the
 * directory is {@link DEFAULT_OUT_DIR} and both file names come from `create2Utils.ts`, which
 * builds them with the same helpers when reading a package back. So this project's own
 * `create2-artifacts/` is already publishable as one of these.
 *
 * The salts file is the index: a package offers exactly the libraries it lists there, and an
 * artifact without an entry is ignored. Both files are needed — the artifact carries the bytes and
 * the identifier, the salt says where those bytes land.
 */
export const LIBRARY_PACKAGES = ["@warptoad/skinny-fat-imt-js"];

/** Where frozen artifacts and the salts file go, unless `--out-dir` says otherwise. */
export const DEFAULT_OUT_DIR = "create2-artifacts";

/** Used for anything with no mined salt and no `--salt`. Any 32 bytes work. */
export const DEFAULT_SALT: Hex = `0x${"02".repeat(32)}`;
