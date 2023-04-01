import crypto from "node:crypto";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import bls from "@chainsafe/bls";
import {AttestationDataCacheEntry, SeenAttestationDatas} from "../../src/chain/seenCache/seenAttestationData.js";
import {testRunnerMemory} from "./testRunnerMemory.js";

/**
 * SeenAttestationDatas 64 keys  - 59686.7 bytes / instance
 * SeenAttestationDatas 128 keys - 119251.5 bytes / instance
 * SeenAttestationDatas 200 keys - 186071.2 bytes / instance
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
  const seenAttestationDatas = new SeenAttestationDatas(0, null);
  for (let i = 0; i < n; i++) {
    const attDataBytes = crypto.randomBytes(128);
    const key = Buffer.from(attDataBytes).toString("base64");
    const secretKey = bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1));
    const signatureSet = {
      type: SignatureSetType.aggregate,
      pubkeys: [secretKey.toPublicKey()],
      signingRoot: crypto.randomBytes(32),
      signature: crypto.randomBytes(96),
    } as ISignatureSet;
    // skip index2pubkey and committeeIndices as they are shared
    const attDataCacheEntry = {
      signatureSet,
      subnet: i,
    } as AttestationDataCacheEntry;
    seenAttestationDatas.add(key, attDataCacheEntry);
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

    // eslint-disable-next-line no-console
    console.log(`${id.padEnd(longestId)} - ${bpi.toFixed(1)} bytes / instance`);
  }
}
