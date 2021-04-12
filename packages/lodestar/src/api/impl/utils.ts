import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks} from "@chainsafe/lodestar-types";
import {ValidatorIndex} from "@chainsafe/lodestar-types/phase0";
import {ByteVector} from "@chainsafe/ssz";
import {IBeaconChain} from "../../chain/interface";
import {IBeaconSync} from "../../sync";
import {ApiError} from "./errors";

/**
 * Check the sync status of the beacon chain.
 */
export async function checkSyncStatus(config: IBeaconConfig, sync: IBeaconSync): Promise<void> {
  if (!sync.isSynced()) {
    let syncStatus;
    try {
      syncStatus = sync.getSyncStatus();
    } catch (e) {
      throw new ApiError(503, "Node is stopped");
    }
    if (syncStatus.syncDistance > config.params.SLOTS_PER_EPOCH) {
      throw new ApiError(
        503,
        `Node is syncing, status: ${JSON.stringify(config.types.phase0.SyncingStatus.toJson(syncStatus))}`
      );
    }
  }
}

export function getStateValidatorIndex(
  id: number | ByteVector,
  state: allForks.BeaconState,
  chain: IBeaconChain
): number | undefined {
  let validatorIndex: ValidatorIndex | undefined;
  if (typeof id === "number") {
    if (state.validators.length > id) {
      validatorIndex = id;
    }
  } else {
    validatorIndex = chain.getHeadState().pubkey2index.get(id) ?? undefined;
    // validator added later than given stateId
    if (validatorIndex && validatorIndex >= state.validators.length) {
      validatorIndex = undefined;
    }
  }
  return validatorIndex;
}
