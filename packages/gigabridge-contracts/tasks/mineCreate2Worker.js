// The mining loop for `hardhat mine-create2`, one instance per thread.
//
// Plain JS on purpose: a worker starts its own module loader, and the TypeScript hooks Hardhat
// registers for the main thread do not carry over to it, so a `.ts` worker would only load if the
// surrounding toolchain happened to strip types for us. Nothing here needs types anyway.
//
// Threads never coordinate. Each seeds the top 28 bytes of its salt randomly and counts through
// the low 4, so two workers colliding is as likely as two random 28-byte values matching.

import { parentPort, workerData } from "node:worker_threads";
import { keccak256, toBytes, toHex } from "viem";

const { factory, initCodeHash, pattern, reportEvery } = workerData;

// keccak256(0xff ‖ factory ‖ salt ‖ initCodeHash), built once and mutated in place — no hex
// strings in the loop, which is most of the speed.
const buffer = new Uint8Array(85);
buffer[0] = 0xff;
buffer.set(toBytes(factory), 1);
buffer.set(toBytes(initCodeHash), 53);
const counter = new DataView(buffer.buffer, 49, 4);

// The 40-character pattern as bytes to compare against, rather than a hex string to build and
// compare per attempt. `want` holds the wanted nibbles and `mask` covers only the fixed ones, so a
// pattern that fixes half a byte (`000` leaves the low nibble of address byte 1 free) still costs a
// single `&` and `!==`. `checks` lists just the byte offsets with anything to check, so a suffix at
// the far end of the address does not mean walking the 18 bytes of wildcards in between.
const want = new Uint8Array(20);
const mask = new Uint8Array(20);
for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === ".") continue;
    const shift = i % 2 === 0 ? 4 : 0;
    want[i >> 1] |= parseInt(pattern[i], 16) << shift;
    mask[i >> 1] |= 0xf << shift;
}
// Ascending, so the leading zeros are tested first: they are the likeliest to fail, and failing on
// the first byte is what keeps the average attempt cheap.
const checked = [];
for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 0) checked.push(i);
}
const checks = Uint8Array.from(checked);

/** Whether the address in `hash` (its last 20 bytes) fits the pattern. */
function matchesPattern(hash) {
    for (let j = 0; j < checks.length; j++) {
        const i = checks[j];
        if ((hash[12 + i] & mask[i]) !== want[i]) return false;
    }
    return true;
}

// The counter only covers 2^32 salts, which a pattern fixing 9 hex characters or more expects to
// run through several times over, so exhausting it just means taking a fresh 28-byte seed and
// starting again. Nothing but a hit stops this loop; the main thread terminates the ones it does
// not need.
for (;;) {
    crypto.getRandomValues(buffer.subarray(21, 49));
    for (let attempt = 0; attempt <= 0xffffffff; attempt++) {
        counter.setUint32(0, attempt);
        if (matchesPattern(keccak256(buffer, "bytes"))) {
            parentPort.postMessage({ salt: toHex(buffer.subarray(21, 53)) });
            process.exit(0);
        }
        if (attempt > 0 && attempt % reportEvery === 0) {
            parentPort.postMessage({ tried: reportEvery });
        }
    }
}
