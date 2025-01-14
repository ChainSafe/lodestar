import crypto from "node:crypto";
import {toHexString} from "@chainsafe/ssz";
import {AttestationDataCacheEntry, SeenAttestationDatas} from "../../src/chain/seenCache/seenAttestationData.js";
import {testRunnerMemory} from "./testRunnerMemory.js";

/**
 * SeenAttestationDatas 64 keys  - 88039.8 bytes / instance
 * SeenAttestationDatas 128 keys - 177436.8 bytes / instance
 * SeenAttestationDatas 200 keys - 276592.0 bytes / instance
 */
testRunnerMemoryBpi([
  {
    id: "SeenAttestationDatas 64 keys",
    getInstance: () => getRandomSeenAttestationDatas(64),
  },
  {
    id: "SeenAttestationDatas 128 keys",
    getInstance: () => getRandomSeenAttestationDatas(128),
  },
  {
    id: "SeenAttestationDatas 200 keys",
    getInstance: () => getRandomSeenAttestationDatas(200),
  },
]);

function getRandomSeenAttestationDatas(n: number): SeenAttestationDatas {
  const seenAttestationDatas = new SeenAttestationDatas(null);
  const slot = 1000;
  for (let i = 0; i < n; i++) {
    const attDataBytes = crypto.randomBytes(128);
    const key = Buffer.from(attDataBytes).toString("base64");
    // skip index2pubkey and committeeIndices as they are shared
    const attDataCacheEntry = {
      signingRoot: crypto.randomBytes(32),
      attDataRootHex: toHexString(crypto.randomBytes(32)),
      subnet: i,
    } as unknown as AttestationDataCacheEntry;
    seenAttestationDatas.add(slot, key, attDataCacheEntry);
  }
  return seenAttestationDatas;
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
