import {itBench} from "@dapplion/benchmark";
import {RootCache, computeStartSlotAtEpoch, getBlockRootAtSlot} from "../../../src/util/index.js";
import {State} from "../types.js";
import {generatePerfTestCachedStatePhase0, perfStateEpoch, perfStateId} from "../util.js";

const slot = computeStartSlotAtEpoch(perfStateEpoch) - 1;

describe("RootCache.getBlockRootAtSlot from rootCache", () => {
  itBench<RootCache, RootCache>({
    id: `RootCache.getBlockRootAtSlot - ${perfStateId}`,
    before: () => new RootCache(generatePerfTestCachedStatePhase0()),
    beforeEach: (rootCache) => rootCache,
    fn: (rootCache) => {
      for (let i = 0; i <= 100; i++) {
        rootCache.getBlockRootAtSlot(slot);
      }
    },
    runsFactor: 100,
  });
});

describe("RootCache.getBlockRootAtSlot", () => {
  itBench<State, State>({
    id: `state getBlockRootAtSlot - ${perfStateId}`,
    before: () => generatePerfTestCachedStatePhase0() as State,
    beforeEach: (state) => state,
    fn: (state) => {
      for (let i = 0; i <= 100; i++) {
        getBlockRootAtSlot(state, slot);
      }
    },
    runsFactor: 100,
  });
});
