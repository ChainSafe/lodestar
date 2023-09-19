import {ApiError} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {AssertionMatch, AssertionResult, SimulationAssertion} from "../interfaces.js";

export function createForkAssertion(fork: ForkName, epoch: Epoch): SimulationAssertion<string, string> {
  return {
    id: `fork-${fork}`,
    match: ({slot, clock}) => {
      return clock.isFirstSlotOfEpoch(slot) && epoch === clock.getEpochForSlot(slot)
        ? AssertionMatch.Assert | AssertionMatch.Remove
        : AssertionMatch.None;
    },
    assert: async ({node, slot, forkConfig}) => {
      const errors: AssertionResult[] = [];

      const res = await node.beacon.api.debug.getStateV2("head");
      ApiError.assert(res);
      const expectedForkVersion = toHexString(forkConfig.getForkInfo(slot).version);
      const currentForkVersion = toHexString(res.response.data.fork.currentVersion);

      if (expectedForkVersion !== currentForkVersion) {
        errors.push([
          "Node is not on correct fork",
          {
            expectedForkVersion,
            currentForkVersion,
          },
        ]);
      }

      return errors;
    },
  };
}
