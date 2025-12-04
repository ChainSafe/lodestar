import {bench, describe} from "@chainsafe/benchmark";
import {ForkSeq} from "@lodestar/params";
import {processSlot} from "../../../src/slot/index.js";
import {State} from "../types.js";
import {generatePerfTestCachedStatePhase0} from "../util.js";

// Test advancing through an empty slot, without any epoch transition

describe("processSlot", () => {
  for (const slotCount of [1, 32]) {
    bench<State, State>({
      id: `processSlot - ${slotCount} slots`,
      before: () => generatePerfTestCachedStatePhase0({goBackOneSlot: true}) as State,
      beforeEach: (state) => state.clone(),
      fn: (state) => {
        for (let i = 0; i < slotCount; i++) {
          state.slot++;
          processSlot(ForkSeq.phase0, state);
        }
      },
    });
  }
});
