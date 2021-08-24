import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {altair} from "../../../../src";
import {FlagFactors, generateBalanceDeltasEpochProcess} from "../../phase0/epoch/util";
import {StateAltairEpoch} from "../../types";
import {generatePerfTestCachedStateAltair, numValidators} from "../../util";
import {mutateInactivityScores} from "./util";

// PERF: Cost = iterate over an array of size $VALIDATOR_COUNT + 'proportional' to how many validtors are inactive or
// have been inactive in the past, i.e. that require an update to their inactivityScore. Worst case = all validators
// need to update their non-zero `inactivityScore`.
//
// On normal mainnet conditions
//   - prevTargetAttester: 96%
//   - unslashed:          100%
//   - eligibleAttester:   98%
//  TODO: Compute from altair testnet inactivityScores updates on average
//
// On worst case:
//   - status = 0xff
//   - all inactivityScores > 0

describe("altair processInactivityUpdates", () => {
  setBenchOpts({maxMs: 60 * 1000});

  const vc = numValidators;

  const testCases: {id: string; isInInactivityLeak: boolean; flagFactors: FlagFactors; factorWithPositive: number}[] = [
    {
      id: "normalcase",
      isInInactivityLeak: false,
      flagFactors: 0xff,
      factorWithPositive: 0.04,
    },
    {
      id: "worstcase",
      isInInactivityLeak: true,
      flagFactors: 0xff,
      factorWithPositive: 0.04,
    },
  ];

  for (const {id, isInInactivityLeak, flagFactors, factorWithPositive} of testCases) {
    itBench<StateAltairEpoch, StateAltairEpoch>({
      id: `altair processInactivityUpdates - ${vc} ${id}`,
      before: () => {
        const state = generatePerfTestCachedStateAltair({goBackOneSlot: true});
        const epochProcess = generateBalanceDeltasEpochProcess(state, isInInactivityLeak, flagFactors);
        mutateInactivityScores(state, factorWithPositive);
        return {state, epochProcess};
      },
      beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
      fn: ({state, epochProcess}) => altair.processInactivityUpdates(state, epochProcess),
    });
  }
});
