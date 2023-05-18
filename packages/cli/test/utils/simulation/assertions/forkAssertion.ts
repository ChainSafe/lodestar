import {ApiError} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {SimulationAssertion} from "../interfaces.js";

export function createForkAssertion(fork: ForkName, epoch: Epoch): SimulationAssertion<string, string> {
  return {
    id: `fork-${fork}`,
    match: ({slot, clock}) => {
      return slot === clock.getFirstSlotOfEpoch(epoch) ? {match: true, remove: true} : false;
    },
    assert: async ({nodes, slot, forkConfig}) => {
      const errors: string[] = [];
      for (const node of nodes) {
        const res = await node.cl.api.debug.getStateV2("head");
        ApiError.assert(res);
        const expectedForkVersion = toHexString(forkConfig.getForkInfo(slot).version);
        const currentForkVersion = toHexString(res.response.data.fork.currentVersion);

        if (expectedForkVersion !== currentForkVersion) {
          errors.push(
            `Node is not on correct fork. ${JSON.stringify({
              id: node.cl.id,
              slot,
              fork,
              expectedForkVersion,
              currentForkVersion,
            })}`
          );
        }
      }

      return errors;
    },
  };
}
