import {bench, describe} from "@chainsafe/benchmark";
import {getEffectiveBalanceIncrementsZeroInactive} from "../../../src/util/index.js";
import {State} from "../types.js";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../util.js";

describe("getEffectiveBalanceIncrementsZeroInactive", () => {
  bench<State, State>({
    id: `getEffectiveBalanceIncrementsZeroInactive - ${perfStateId}`,
    noThreshold: true,
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
