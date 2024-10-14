import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {digest} from "@chainsafe/as-sha256";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {phase0, ssz} from "@lodestar/types";
import {computeSigningRoot} from "../../../src/util/signingRoot.js";

/**
 * As of Apr 2023, when we apply new gossip queues we process all gossip attestations and computeSiningRoot may take up to 6% of cpu.
 * The below benchmark results show that if we use Buffer.toString(base64) against serialized attestation data, it is still way cheaper
 * than computeSigningRoot.
 * Based on that we can cache attestation data as string in order to avoid recomputing signing root when validating gossip attestations.
 * computeSigningRoot
    ✔ computeSigningRoot for AttestationData                              94788.17 ops/s    10.54984 us/op        -        901 runs   10.0 s
    ✔ hash AttestationData serialized data then Buffer.toString(base64    509425.9 ops/s    1.962994 us/op        -       4856 runs   10.0 s
    ✔ toHexString serialized data                                         727592.3 ops/s    1.374396 us/op        -       6916 runs   10.0 s
    ✔ Buffer.toString(base64)                                              2570800 ops/s    388.9840 ns/op        -      24628 runs   10.1 s
 */
describe("computeSigningRoot", () => {
  setBenchOpts({
    minMs: 10_000,
  });

  const type = ssz.phase0.AttestationData;
  const seedObject: phase0.AttestationData = {
    slot: 6118259,
    index: 46,
    beaconBlockRoot: fromHexString("0x94cef26d543b20568a4bbb77ae2ba203826912065348613a437a9106142aff85"),
    source: {
      epoch: 191194,
      root: fromHexString("0x1a955a91af4ee915c1f267f0026668c58237c1a23bd6c106ef05459741a9171c"),
    },
    target: {
      epoch: 191195,
      root: fromHexString("0x48db1209cd969a1a74eb19d1c5e24021d3a4ac45b8b1b2c1b0e8b0c1b0e8b0c1"),
    },
  };

  const bytes = type.serialize(seedObject);
  const domain = new Uint8Array(32);
  itBench({
    id: "computeSigningRoot for AttestationData",
    fn: () => {
      for (let i = 0; i < 1000; i++) {
        computeSigningRoot(type, clone(seedObject), domain);
      }
    },
    runsFactor: 1000,
  });

  itBench({
    id: "hash AttestationData serialized data then Buffer.toString(base64)",
    fn: () => {
      for (let i = 0; i < 1000; i++) {
        clone(seedObject);
        Buffer.from(digest(bytes)).toString("base64");
      }
    },
    runsFactor: 1000,
  });

  itBench({
    id: "toHexString serialized data",
    fn: () => {
      for (let i = 0; i < 1000; i++) {
        clone(seedObject);
        toHexString(bytes);
      }
    },
    runsFactor: 1000,
  });

  itBench({
    id: "Buffer.toString(base64)",
    fn: () => {
      for (let i = 0; i < 1000; i++) {
        clone(seedObject);
        Buffer.from(bytes).toString("base64");
      }
    },
    runsFactor: 1000,
  });
});

function clone(sszObject: phase0.AttestationData): phase0.AttestationData {
  return {
    slot: sszObject.slot,
    index: sszObject.index,
    beaconBlockRoot: sszObject.beaconBlockRoot,
    source: sszObject.source,
    target: sszObject.target,
  };
}
