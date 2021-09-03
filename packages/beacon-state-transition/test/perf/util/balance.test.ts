import {itBench} from "@dapplion/benchmark";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../util";
import {State} from "../types";
import {getEffectiveBalances} from "../../../src/util";

describe("getEffectiveBalances", () => {
  itBench<State, State>({
    id: `getEffectiveBalances - ${perfStateId}`,
    before: () => generatePerfTestCachedStatePhase0() as State,
    beforeEach: (state) => state.clone(),
    fn: (state) => {
      for (let i = 0; i <= 100; i++) {
        getEffectiveBalances(state);
      }
    },
    runsFactor: 100,
  });
});
