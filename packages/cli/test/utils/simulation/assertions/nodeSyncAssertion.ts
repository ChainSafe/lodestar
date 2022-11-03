import {SimulationAssertion} from "../interfaces.js";
import {neverMatcher} from "./matchers.js";

export const nodeSyncAssertion: SimulationAssertion<"nodeSync", boolean> = {
  key: "nodeSync",
  // Include into particular test with custom condition
  match: neverMatcher,
  async assert({nodes}) {
    const errors: string[] = [];

    for (const node of nodes) {
      const res = await node.cl.api.node.getSyncingStatus();
      if (!res.data.isSyncing) {
        errors.push(`Node ${node.cl.id} is still syncing`);
      }
    }

    return errors;
  },
};
