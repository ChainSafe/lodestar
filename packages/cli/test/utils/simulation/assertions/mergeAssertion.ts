import {ApiError} from "@lodestar/api";
import {BeaconStateAllForks, isExecutionStateType, isMergeTransitionComplete} from "@lodestar/state-transition";
import {SimulationAssertion} from "../interfaces.js";
import {neverMatcher} from "./matchers.js";

export const mergeAssertion: SimulationAssertion<"merge", string> = {
  id: "merge",
  // Include into particular test with custom condition
  match: neverMatcher,
  async assert({nodes, epoch, slot}) {
    const errors: string[] = [];

    for (const node of nodes) {
      const res = await node.cl.api.debug.getStateV2("head");
      ApiError.assert(res);
      const state = (res.response.data as unknown) as BeaconStateAllForks;

      if (!(isExecutionStateType(state) && isMergeTransitionComplete(state))) {
        errors.push(
          `Node has not yet completed the merged transition. ${JSON.stringify({
            id: node.cl.id,
            epoch,
            slot,
          })}`
        );
      }
    }

    return errors;
  },
};
