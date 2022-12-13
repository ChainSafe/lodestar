import {IBeaconConfig} from "@lodestar/config";
import {altair, Slot} from "@lodestar/types";
import {LightClientStore} from "../types.js";
import {processLightClientUpdate} from "./processLightClientUpdate.js";
import {ZERO_NEXT_SYNC_COMMITTEE_BRANCH, ZERO_SYNC_COMMITTEE} from "./utils.js";

export function processLightClientFinalityUpdate(
  config: IBeaconConfig,
  store: LightClientStore,
  finalityUpdate: altair.LightClientFinalityUpdate,
  currentSlot: Slot
): void {
  const update: altair.LightClientUpdate = {
    attestedHeader: finalityUpdate.attestedHeader,
    nextSyncCommittee: ZERO_SYNC_COMMITTEE,
    nextSyncCommitteeBranch: ZERO_NEXT_SYNC_COMMITTEE_BRANCH,
    finalizedHeader: finalityUpdate.finalizedHeader,
    finalityBranch: finalityUpdate.finalityBranch,
    syncAggregate: finalityUpdate.syncAggregate,
    signatureSlot: finalityUpdate.signatureSlot,
  };
  processLightClientUpdate(config, store, update, currentSlot);
}
