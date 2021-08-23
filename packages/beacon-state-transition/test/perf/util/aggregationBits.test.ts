import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {MAX_VALIDATORS_PER_COMMITTEE} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {List, readonlyValues} from "@chainsafe/ssz";
import {zipIndexesCommitteeBits} from "../../../src";

describe("aggregationBits", () => {
  setBenchOpts({maxMs: 60 * 1000, threshold: Infinity});

  const len = MAX_VALIDATORS_PER_COMMITTEE;
  const aggregationBits = Array.from({length: len}, () => true);
  const indexes = Array.from({length: len}, () => 165432);
  const bitlistTree = ssz.phase0.CommitteeBits.createTreeBackedFromStruct(aggregationBits as List<boolean>);

  const idPrefix = `aggregationBits - ${len} els`;

  // aggregationBits - 2048 els - readonlyValues	228.51 us/op	583.42 us/op	0.39
  // aggregationBits - 2048 els - zipIndexesInBitList	50.904 us/op	236.17 us/op	0.22

  // This benchmark is very unstable in CI. We already know that zipIndexesInBitList is faster
  itBench(`${idPrefix} - readonlyValues`, () => {
    Array.from(readonlyValues(bitlistTree));
  });

  itBench(`${idPrefix} - zipIndexesInBitList`, () => {
    zipIndexesCommitteeBits(indexes, bitlistTree);
  });
});
