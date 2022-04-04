import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {MAX_VALIDATORS_PER_COMMITTEE} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {BitArray} from "@chainsafe/ssz";

describe("aggregationBits", () => {
  setBenchOpts({noThreshold: true});

  const len = MAX_VALIDATORS_PER_COMMITTEE;
  const idPrefix = `aggregationBits - ${len} els`;

  let indexes: number[];
  let bitlistTree: BitArray;

  before(function () {
    const aggregationBits = BitArray.fromBoolArray(Array.from({length: len}, () => true));
    bitlistTree = ssz.phase0.CommitteeBits.toViewDU(aggregationBits);
    indexes = Array.from({length: len}, () => 165432);
  });

  // aggregationBits - 2048 els - readonlyValues	228.51 us/op	583.42 us/op	0.39
  // aggregationBits - 2048 els - zipIndexesInBitList	50.904 us/op	236.17 us/op	0.22

  // This benchmark is very unstable in CI. We already know that zipIndexesInBitList is faster
  itBench(`${idPrefix} - zipIndexesInBitList`, () => {
    bitlistTree.intersectValues(indexes);
  });
});
