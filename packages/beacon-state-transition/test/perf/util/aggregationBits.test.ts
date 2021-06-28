import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {MAX_VALIDATORS_PER_COMMITTEE} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {List, readonlyValues} from "@chainsafe/ssz";
import {zipIndexesCommitteeBits} from "../../../src";

describe("aggregationBits", () => {
  setBenchOpts({
    maxMs: 60 * 1000,
    minMs: 1 * 1000,
    runs: 1024,
  });

  const len = MAX_VALIDATORS_PER_COMMITTEE;
  const aggregationBits = Array.from({length: len}, () => true);
  const indexes = Array.from({length: len}, () => 165432);
  const bitlistTree = ssz.phase0.CommitteeBits.createTreeBackedFromStruct(aggregationBits as List<boolean>);

  const idPrefix = `aggregationBits - ${len} els`;

  itBench(`${idPrefix} - readonlyValues`, () => {
    Array.from(readonlyValues(bitlistTree));
  });

  itBench(`${idPrefix} - zipIndexesInBitList`, () => {
    zipIndexesCommitteeBits(indexes, bitlistTree);
  });
});
