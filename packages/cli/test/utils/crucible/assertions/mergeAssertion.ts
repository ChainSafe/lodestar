import {BeaconStateAllForks, isExecutionStateType} from "@lodestar/state-transition";
import {Assertion, AssertionResult} from "../interfaces.js";
import {neverMatcher} from "./matchers.js";

export const mergeAssertion: Assertion<"merge", string> = {
  id: "merge",
  // Include into particular test with custom condition
  match: neverMatcher,
  async assert({node}) {
    const errors: AssertionResult[] = [];

    const res = await node.beacon.api.debug.getStateV2({stateId: "head"});
    const state = res.value() as unknown as BeaconStateAllForks;

    // Post-merge, we just check that the state is an execution state type (Bellatrix+)
    if (!isExecutionStateType(state)) {
      errors.push("Node state is not an execution state type (pre-Bellatrix)");
    }

    return errors;
  },
};
