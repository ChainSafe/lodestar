import {itBench} from "@dapplion/benchmark";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../util";
import {State} from "../types";
import {getEffectiveBalanceIncrementsZeroInactive} from "../../../src/util";

describe("getEffectiveBalanceIncrementsZeroInactive", () => {
  itBench<State, State>({
    id: `getEffectiveBalanceIncrementsZeroInactive - ${perfStateId}`,
    before: () => generatePerfTestCachedStatePhase0() as State,
    beforeEach: (state) => state.clone(),
    fn: (state) => {
      for (let i = 0; i <= 100; i++) {
        getEffectiveBalanceIncrementsZeroInactive(state);
      }
    },
    runsFactor: 100,
  });
});
