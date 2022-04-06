import {itBench} from "@dapplion/benchmark";
import {altair} from "../../../../src/index.js";
import {generatePerfTestCachedStateAltair, numValidators} from "../../util";
import {FlagFactors, generateBalanceDeltasEpochProcess} from "../../phase0/epoch/util.js";
import {StateAltairEpoch} from "../../types.js";
import {mutateInactivityScores} from "./util.js";

// PERF: Cost = 'proportional' to $VALIDATOR_COUNT. Extra work is done per validator the more status flags are set

// Worst case:
// statuses: everything true
// inactivityScore > 0

describe("altair processRewardsAndPenalties", () => {
  const vc = numValidators;
  const testCases: {id: string; isInInactivityLeak: boolean; flagFactors: FlagFactors; factorWithPositive: number}[] = [
    {
      id: "normalcase",
      isInInactivityLeak: false,
      flagFactors: {
        prevSourceAttester: 0.98,
        prevTargetAttester: 0.96,
        prevHeadAttester: 0.93,
        currSourceAttester: 0.95,
        currTargetAttester: 0.93,
        currHeadAttester: 0.91,
        unslashed: 1,
        eligibleAttester: 0.98,
      },
      factorWithPositive: 0.04,
    },
    {
      id: "worstcase",
      isInInactivityLeak: true,
      flagFactors: 0xff,
      factorWithPositive: 1,
    },
  ];

  for (const {id, isInInactivityLeak, flagFactors, factorWithPositive} of testCases) {
    itBench<StateAltairEpoch, StateAltairEpoch>({
      id: `altair processRewardsAndPenalties - ${vc} ${id}`,
      yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
      before: () => {
        const state = generatePerfTestCachedStateAltair({goBackOneSlot: true});
        const epochProcess = generateBalanceDeltasEpochProcess(state, isInInactivityLeak, flagFactors);
        mutateInactivityScores(state, factorWithPositive);
        return {state, epochProcess};
      },
      beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
      fn: ({state, epochProcess}) => altair.processRewardsAndPenalties(state, epochProcess),
    });
  }
});
