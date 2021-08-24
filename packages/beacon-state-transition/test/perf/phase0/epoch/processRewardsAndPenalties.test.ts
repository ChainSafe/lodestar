import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {phase0} from "../../../../src";
import {generatePerfTestCachedStatePhase0, numValidators} from "../../util";
import {StatePhase0Epoch} from "../../types";
import {FlagFactors, generateBalanceDeltasEpochProcess} from "./util";

// - On normal mainnet conditions
//   - prevSourceAttester: 98%
//   - prevTargetAttester: 96%
//   - prevHeadAttester:   93%
//   - currSourceAttester: 95%
//   - currTargetAttester: 93%
//   - currHeadAttester:   91%
//   - unslashed:          100%
//   - eligibleAttester:   98%

describe("phase0 getAttestationDeltas", () => {
  setBenchOpts({maxMs: 60 * 1000});

  const vc = numValidators;
  const testCases: {id: string; isInInactivityLeak: boolean; flagFactors: FlagFactors}[] = [
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
    },
    {
      id: "worstcase",
      isInInactivityLeak: true,
      flagFactors: 0xff,
    },
  ];

  for (const {id, isInInactivityLeak, flagFactors} of testCases) {
    itBench<StatePhase0Epoch, StatePhase0Epoch>({
      id: `phase0 processRewardsAndPenalties - ${vc} ${id}`,
      before: () => {
        const state = generatePerfTestCachedStatePhase0({goBackOneSlot: true});
        const epochProcess = generateBalanceDeltasEpochProcess(state, isInInactivityLeak, flagFactors);
        return {state, epochProcess};
      },
      beforeEach: ({state, epochProcess}) => ({state: state.clone(), epochProcess}),
      fn: ({state, epochProcess}) => {
        phase0.getAttestationDeltas(state, epochProcess);
      },
    });
  }
});
