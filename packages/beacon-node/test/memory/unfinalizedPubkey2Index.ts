import crypto from "node:crypto";
// biome-ignore lint/suspicious/noShadowRestrictedNames: We explicitly want `Map` name to be imported
import {Map} from "immutable";
import {ValidatorIndex} from "@lodestar/types";
import {toMemoryEfficientHexStr} from "@lodestar/state-transition/src/cache/pubkeyCache.js";
import {testRunnerMemory} from "./testRunnerMemory.js";

// Results in MacOS Nov 2023
//
// UnfinalizedPubkey2Index 1000 keys   - 274956.5 bytes / instance
// UnfinalizedPubkey2Index 10000 keys  - 2591129.3 bytes / instance
// UnfinalizedPubkey2Index 100000 keys - 27261443.4 bytes / instance

testRunnerMemoryBpi([
  {
    id: "UnfinalizedPubkey2Index 1000 keys",
    getInstance: () => getRandomMap(1000, () => toMemoryEfficientHexStr(crypto.randomBytes(48))),
  },
  {
    id: "UnfinalizedPubkey2Index 10000 keys",
    getInstance: () => getRandomMap(10000, () => toMemoryEfficientHexStr(crypto.randomBytes(48))),
  },
  {
    id: "UnfinalizedPubkey2Index 100000 keys",
    getInstance: () => getRandomMap(100000, () => toMemoryEfficientHexStr(crypto.randomBytes(48))),
  },
]);

function getRandomMap(n: number, getKey: (i: number) => string): Map<string, unknown> {
  const map = Map<string, ValidatorIndex>();

  return map.withMutations((m) => {
    for (let i = 0; i < n; i++) {
      m.set(getKey(i), i);
    }
  });
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
