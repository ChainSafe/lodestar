import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {createFastConfirmationCache} from "../../../src/forkChoice/fastConfirmation/data.js";
import {computeSafetyThreshold} from "../../../src/forkChoice/fastConfirmation/utils.js";
import {
  ZERO_ROOT,
  makeBlock,
  makeContext,
  makeState,
  makeStore,
} from "../../unit/forkChoice/fastConfirmationTestUtils.js";

// Run with: pnpm exec tsx packages/fork-choice/test/perf/forkChoice/committeeSweep.ts
// Explicitly evaluate every threshold: the rule runner can stop early on insufficient support.
assert.equal(SLOTS_PER_EPOCH, 32, "benchmark requires mainnet preset");
const samples = 20;
for (const validatorCount of [100_000, 600_000, 1_000_000]) {
  for (const gap of [1, 2, 8, 32]) {
    const currentSlot = 3 * SLOTS_PER_EPOCH;
    const base = makeState(validatorCount, 32, []);
    const indices = Array.from({length: 3}, (_, epoch) =>
      Uint32Array.from({length: validatorCount}, (_, i) => (i + epoch * 7919) % validatorCount)
    );
    let committeeReads = 0;
    const state = {
      ...base,
      getBeaconCommittee: (slot: Slot) => {
        committeeReads++;
        const offset = slot % SLOTS_PER_EPOCH;
        return indices[Math.floor(slot / SLOTS_PER_EPOCH)].subarray(
          Math.floor((offset * validatorCount) / SLOTS_PER_EPOCH),
          Math.floor(((offset + 1) * validatorCount) / SLOTS_PER_EPOCH)
        );
      },
    };
    const blocks = [makeBlock(0, ZERO_ROOT)];
    for (let slot = 32; slot < currentSlot; slot += gap) {
      blocks.push(makeBlock(slot, blocks.at(-1)?.blockRoot ?? ZERO_ROOT));
    }
    const head = blocks.at(-1);
    assert(head);
    const ctx = makeContext(
      currentSlot as Slot,
      head.blockRoot,
      blocks,
      new Map(),
      {epoch: 1, rootHex: ZERO_ROOT},
      state
    );
    const store = makeStore(head.blockRoot, ZERO_ROOT, ZERO_ROOT, 1, 1, head.blockRoot, head.blockRoot, state);
    const source = {state, balances: state.effectiveBalanceIncrements};
    const run = () => {
      const cache = createFastConfirmationCache();
      let checksum = 0;
      // Descending order matches the confirmed-chain safety walk. Exclude the anchor's genesis gap.
      for (let i = blocks.length - 1; i >= 2; i--) {
        checksum += computeSafetyThreshold(ctx, store, cache, source, blocks[i].blockRoot).threshold;
      }
      return {cache, checksum};
    };
    const reference = run();
    for (let i = 0; i < 5; i++) assert.equal(run().checksum, reference.checksum);
    const times: number[] = [];
    committeeReads = 0;
    for (let i = 0; i < samples; i++) {
      const start = performance.now();
      const result = run();
      times.push(performance.now() - start);
      assert.equal(result.checksum, reference.checksum);
    }
    times.sort((a, b) => a - b);
    let sweepBytes = 0;
    let usedOrderBytes = 0;
    for (const sweep of reference.cache.committeeSweepByEndSlot.values()) {
      sweepBytes += sweep.seen.byteLength + sweep.order.byteLength;
      usedOrderBytes += (sweep.lengths.at(-1) ?? 0) * Uint32Array.BYTES_PER_ELEMENT;
    }
    console.log(
      JSON.stringify({
        validatorCount,
        gap,
        thresholds: blocks.length - 2,
        samples,
        medianMs: Number(times[Math.floor(samples / 2)].toFixed(2)),
        p95Ms: Number(times[Math.ceil(samples * 0.95) - 1].toFixed(2)),
        sweeps: reference.cache.committeeSweepByEndSlot.size,
        sweepBytes,
        usedOrderBytes,
        rangeBytes: [...reference.cache.participantsByRange.values()].reduce((sum, value) => sum + value.byteLength, 0),
        committeeReadsPerRun: committeeReads / samples,
      })
    );
  }
}
