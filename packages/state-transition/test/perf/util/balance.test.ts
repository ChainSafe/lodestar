import {bench, describe} from "@chainsafe/benchmark";
import {generatePerfTestCachedStatePhase0, perfStateId} from "../../../src/testUtils/util.js";
import {getEffectiveBalanceIncrementsZeroInactive} from "../../../src/util/index.js";
import {State} from "../types.js";

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
