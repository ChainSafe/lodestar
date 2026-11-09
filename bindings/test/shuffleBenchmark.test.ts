import {beforeAll, describe, expect, it, vi} from "vitest";
import {deterministicBenchmarkSeed} from "../perf/benchmarkSeed.js";
import * as shuffle from "../src/shuffle.js";
import * as shuffleReference from "./shuffleReference.js";

const cases = vi.hoisted(() => new Map<string, () => unknown>());
vi.mock("@chainsafe/benchmark", () => ({
  bench: ({id, fn}: {id: string; fn: () => unknown}) => {
    if (cases.has(id)) throw new Error(`Duplicate benchmark ID: ${id}`);
    cases.set(id, fn);
  },
  describe: (_name: string, collect: () => void) => collect(),
}));

beforeAll(async () => {
  await import("../perf/shuffle.test.js");
});

describe("sync committee benchmark workloads", () => {
  it.each([16_384, 250_000, 1_000_000])(
    "uses the same deterministic 32 ETH workload for %i validators",
    {timeout: 60_000},
    (size) => {
      const nativeId = `zig - computeSyncCommitteeIndices - ${size} indices - 32 ETH`;
      const referenceId = `JS  - computeSyncCommitteeIndicesElectra - ${size} indices - 32 ETH`;
      expect(cases.has(nativeId)).toBe(true);
      expect(cases.has(referenceId)).toBe(true);
      const native = vi.spyOn(shuffle, "computeSyncCommitteeIndices");
      const reference = vi.spyOn(shuffleReference, "naiveComputeSyncCommitteeIndicesElectra");
      try {
        cases.get(nativeId)?.();
        cases.get(referenceId)?.();
        expect(native).toHaveBeenCalledTimes(1);
        expect(reference).toHaveBeenCalledTimes(1);
        const [seed, indices, balances, byteCount, committeeSize, maxBalance, increment, rounds] = native.mock.calls[0];
        expect(seed).toEqual(deterministicBenchmarkSeed(`committee-indices:${size}`));
        expect(indices.length).toBe(size);
        expect(indices.every((index, position) => index === position)).toBe(true);
        expect(balances.length).toBe(size);
        expect(balances.every((balance) => balance === 32)).toBe(true);
        expect(byteCount).toBe(2);
        expect(committeeSize).toBe(shuffleReference.SYNC_COMMITTEE_SIZE);
        expect(maxBalance).toBe(shuffleReference.MAX_EFFECTIVE_BALANCE_ELECTRA);
        expect(increment).toBe(shuffleReference.EFFECTIVE_BALANCE_INCREMENT);
        expect(rounds).toBe(shuffleReference.SHUFFLE_ROUND_COUNT);
        expect(reference.mock.calls[0][0]).toBe(seed);
        expect(reference.mock.calls[0][1]).toBe(indices);
        expect(reference.mock.calls[0][2]).toBe(balances);
        expect(native.mock.results[0].value).toHaveLength(512);
        expect(Array.from(native.mock.results[0].value)).toEqual(reference.mock.results[0].value);
      } finally {
        native.mockRestore();
        reference.mockRestore();
      }
    }
  );
});
