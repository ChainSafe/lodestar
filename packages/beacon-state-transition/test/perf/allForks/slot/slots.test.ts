import {itBench} from "@dapplion/benchmark";
import {generatePerfTestCachedStatePhase0} from "../../util";
import {processSlot} from "../../../../src/allForks/slot";
import {State} from "../../types";

// Test advancing through an empty slot, without any epoch transition

describe("processSlot", () => {
  for (const slotCount of [1, 32]) {
    itBench<State, State>({
      id: `processSlot - ${slotCount} slots`,
      before: () => generatePerfTestCachedStatePhase0({goBackOneSlot: true}) as State,
      beforeEach: (state) => state.clone(),
      fn: (state) => {
        for (let i = 0; i < slotCount; i++) {
          state.slot++;
          processSlot(state);
        }
      },
    });
  }
});
