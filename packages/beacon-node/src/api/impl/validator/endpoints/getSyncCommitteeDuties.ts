import {ServerApi, routes} from "@lodestar/api";
import {isOptimisticBlock} from "../../../../util/forkChoice.js";
import {ApiModules} from "../../types.js";
import {getPubkeysForIndices} from "../utils.js";
import {ApiError} from "../../errors.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildGetSyncCommitteeDuties(
  {chain}: ApiModules,
  {notWhileSyncing, waitForNextClosestEpoch}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["getSyncCommitteeDuties"] {
  /**
   * `POST /eth/v1/validator/duties/sync/{epoch}`
   *
   * Requests the beacon node to provide a set of sync committee duties for a particular epoch.
   * - Although pubkey can be inferred from the index we return it to keep this call analogous with the one that
   *   fetches attester duties.
   * - `sync_committee_index` is the index of the validator in the sync committee. This can be used to infer the
   *   subnet to which the contribution should be broadcast. Note, there can be multiple per validator.
   *
   * https://github.com/ethereum/beacon-APIs/pull/134
   *
   * @param validatorIndices an array of the validator indices for which to obtain the duties.
   */
  return async function getSyncCommitteeDuties(epoch, validatorIndices) {
    notWhileSyncing();

    if (validatorIndices.length === 0) {
      throw new ApiError(400, "No validator to get attester duties");
    }

    // May request for an epoch that's in the future
    await waitForNextClosestEpoch();

    // sync committee duties have a lookahead of 1 day. Assuming the validator only requests duties for upcoming
    // epochs, the head state will very likely have the duties available for the requested epoch.
    // Note: does not support requesting past duties
    const head = chain.forkChoice.getHead();
    const state = chain.getHeadState();

    // Check that all validatorIndex belong to the state before calling getCommitteeAssignments()
    const pubkeys = getPubkeysForIndices(state.validators, validatorIndices);
    // Ensures `epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD <= current_epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1`
    const syncCommitteeCache = state.epochCtx.getIndexedSyncCommitteeAtEpoch(epoch);
    const syncCommitteeValidatorIndexMap = syncCommitteeCache.validatorIndexMap;

    const duties: routes.validator.SyncDuty[] = [];
    for (let i = 0, len = validatorIndices.length; i < len; i++) {
      const validatorIndex = validatorIndices[i];
      const validatorSyncCommitteeIndices = syncCommitteeValidatorIndexMap.get(validatorIndex);
      if (validatorSyncCommitteeIndices) {
        duties.push({
          pubkey: pubkeys[i],
          validatorIndex,
          validatorSyncCommitteeIndices,
        });
      }
    }

    return {
      data: duties,
      executionOptimistic: isOptimisticBlock(head),
    };
  };
}
