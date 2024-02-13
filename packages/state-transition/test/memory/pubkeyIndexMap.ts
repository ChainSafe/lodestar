import crypto from "node:crypto";
import {PubkeyIndexMap as PubkeyIndexMapRust} from "@chainsafe/pubkey-index-map";
import {testRunnerMemory} from "@lodestar/beacon-node/test/memory/testRunnerMemory";
import {PubkeyIndexMap as PubkeyIndexMapJs} from "../utils/oldPubkeyCache.js";

/**
 * PubkeyIndexMap(js) 200 keys
 * PubkeyIndexMap(rust) 200 keys
 */
testRunnerMemoryBpi([
  {
    id: "PubkeyIndexMap(rust) 200 keys",
    getInstance: () => getRandomPubkeyIndexMapRust(20000),
  },
  {
    id: "PubkeyIndexMap(js) 200 keys",
    getInstance: () => getRandomPubkeyIndexMapJs(20000),
  },
]);

function getRandomPubkeyIndexMapJs(n: number): PubkeyIndexMapJs {
  const map = new PubkeyIndexMapJs();
  const pubkeys = [];
  for (let i = 0; i < n; i++) {
    const pubkey = Uint8Array.prototype.slice.call(crypto.randomBytes(48));
    pubkeys.push(pubkey);
    map.set(pubkey, n);
  }
  return map;
}

function getRandomPubkeyIndexMapRust(n: number): PubkeyIndexMapRust {
  const map = new PubkeyIndexMapRust();
  const pubkeys = [];
  for (let i = 0; i < n; i++) {
    const pubkey = Uint8Array.prototype.slice.call(crypto.randomBytes(48));
    pubkeys.push(pubkey);
    map.set(pubkey, n);
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
      computeUsedMemory: (mem) => mem.rss,
    });

    // eslint-disable-next-line no-console
    console.log(`${id.padEnd(longestId)} - ${bpi.toFixed(1)} bytes / instance`);
  }
}
