import {MAX_VALIDATORS_PER_COMMITTEE} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {BenchmarkRunner} from "@chainsafe/lodestar-utils/test_utils/benchmark";
import {List, readonlyValues} from "@chainsafe/ssz";
import {zipIndexesCommitteeBits} from "../../../src";

export async function runAggregationBitsTest(): Promise<void> {
  const runner = new BenchmarkRunner("aggregationBits", {
    maxMs: 5 * 60 * 1000,
    minMs: 15 * 1000,
    runs: 512,
  });

  const aggregationBits = Array.from({length: MAX_VALIDATORS_PER_COMMITTEE}, () => true);
  const indexes = Array.from({length: MAX_VALIDATORS_PER_COMMITTEE}, () => 165432);
  const bitlistTree = ssz.phase0.CommitteeBits.createTreeBackedFromStruct(aggregationBits as List<boolean>);

  await runner.run({
    id: "readonlyValues",
    run: () => {
      Array.from(readonlyValues(bitlistTree));
    },
  });

  await runner.run({
    id: "zipIndexesInBitList",
    run: () => {
      zipIndexesCommitteeBits(indexes, bitlistTree);
    },
  });

  runner.done();
}
