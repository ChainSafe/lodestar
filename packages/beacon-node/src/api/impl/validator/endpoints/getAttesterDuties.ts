import {ServerApi, routes} from "@lodestar/api";
import {toHex} from "@lodestar/utils";
import {attesterShufflingDecisionRoot} from "@lodestar/state-transition";
import {RegenCaller} from "../../../../chain/regen/interface.js";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";
import {ApiModules} from "../../types.js";
import {getPubkeysForIndices} from "../utils.js";
import {ApiError} from "../../errors.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildGetAttesterDuties(
  {chain}: ApiModules,
  {notWhileSyncing, getGenesisBlockRoot, waitForNextClosestEpoch}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["getAttesterDuties"] {
  return async function getAttesterDuties(epoch, validatorIndices) {
    notWhileSyncing();

    if (validatorIndices.length === 0) {
      throw new ApiError(400, "No validator to get attester duties");
    }

    // May request for an epoch that's in the future
    await waitForNextClosestEpoch();

    // should not compare to headEpoch in order to handle skipped slots
    // Check if the epoch is in the future after waiting for requested slot
    if (epoch > chain.clock.currentEpoch + 1) {
      throw new ApiError(400, "Cannot get duties for epoch more than one ahead");
    }

    const head = chain.forkChoice.getHead();
    const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.getDuties);

    // TODO: Determine what the current epoch would be if we fast-forward our system clock by
    // `MAXIMUM_GOSSIP_CLOCK_DISPARITY`.
    //
    // Most of the time, `tolerantCurrentEpoch` will be equal to `currentEpoch`. However, during
    // the first `MAXIMUM_GOSSIP_CLOCK_DISPARITY` duration of the epoch `tolerantCurrentEpoch`
    // will equal `currentEpoch + 1`

    // Check that all validatorIndex belong to the state before calling getCommitteeAssignments()
    const pubkeys = getPubkeysForIndices(state.validators, validatorIndices);
    const committeeAssignments = state.epochCtx.getCommitteeAssignments(epoch, validatorIndices);
    const duties: routes.validator.AttesterDuty[] = [];
    for (let i = 0, len = validatorIndices.length; i < len; i++) {
      const validatorIndex = validatorIndices[i];
      const duty = committeeAssignments.get(validatorIndex) as routes.validator.AttesterDuty | undefined;
      if (duty) {
        // Mutate existing object instead of re-creating another new object with spread operator
        // Should be faster and require less memory
        duty.pubkey = pubkeys[i];
        duties.push(duty);
      }
    }

    const dependentRoot = attesterShufflingDecisionRoot(state, epoch) || (await getGenesisBlockRoot(state));

    return {
      data: duties,
      dependentRoot: toHex(dependentRoot),
      executionOptimistic: isOptimisticBlock(head),
    };
  };
}
