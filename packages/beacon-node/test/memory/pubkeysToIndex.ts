import crypto from "node:crypto";
import {toHexString} from "@chainsafe/ssz";
import {testRunnerMemory} from "./testRunnerMemory.js";

// Results in Linux Jan 2022
//
// (pkCount = 100_000)
// Map BLS pubkey 48 bytes toHexString - 144437161.0 bytes / instance
// Map BLS pubkey 48 bytes hex         - 14868449.0 bytes / instance
// Map BLS pubkey 4 bytes hex          - 6070482.9 bytes / instance
//
// (pkCount = 10_000)
// Map BLS pubkey 48 bytes toHexString - 14539050.1 bytes / instance
// Map BLS pubkey 48 bytes hex         - 1578660.8 bytes / instance
// Map BLS pubkey 4 bytes hex          - 698867.0 bytes / instance

const pkCount = 10000;

testRunnerMemoryBpi([
  {
    id: "Map BLS pubkey 48 bytes toHexString",
    getInstance: () => getRandomMap(pkCount, () => toHexString(crypto.randomBytes(48))),
  },
  {
    id: "Map BLS pubkey 48 bytes hex",
    getInstance: () => getRandomMap(pkCount, () => crypto.randomBytes(48).toString("hex")),
  },
  {
    id: "Map BLS pubkey 4 bytes hex",
    getInstance: () => getRandomMap(pkCount, () => crypto.randomBytes(4).toString("hex")),
  },
]);

function getRandomMap(n: number, getKey: (i: number) => string): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (let i = 0; i < n; i++) {
    map.set(getKey(i), i);
  }
  return map;
}

/**
 * Test bytes per instance in different representations of raw binary data
 */
function testRunnerMemoryBpi(testCases: {getInstance: (bytes: number) => unknown; id: string}[]): void {
  const longestId = Math.max(...testCases.map(({id}) => id.length));

  for (const {id, getInstance} of testCases) {
    const bpi = testRunnerMemory({
      getInstance,
      convergeFactor: 1 / 100,
      sampleEvery: 5,
    });

    console.log(`${id.padEnd(longestId)} - ${bpi.toFixed(1)} bytes / instance`);
  }
}
