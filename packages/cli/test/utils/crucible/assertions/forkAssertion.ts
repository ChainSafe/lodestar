import {ForkName} from "@lodestar/params";
import {Epoch} from "@lodestar/types";
import {toHexString} from "@lodestar/utils";
import {Assertion, AssertionResult, Match} from "../interfaces.js";

export function createForkAssertion(fork: ForkName, epoch: Epoch): Assertion<string, string> {
  return {
    id: `fork-${fork}`,
    match: ({slot, clock}) => {
      return clock.isFirstSlotOfEpoch(slot) && epoch === clock.getEpochForSlot(slot)
        ? Match.Assert | Match.Remove
        : Match.None;
    },
    assert: async ({node, slot, forkConfig}) => {
      const errors: AssertionResult[] = [];

      const state = (await node.beacon.api.debug.getStateV2({stateId: "head"})).value();
      const expectedForkVersion = toHexString(forkConfig.getForkInfo(slot).version);
      const currentForkVersion = toHexString(state.fork.currentVersion);

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
