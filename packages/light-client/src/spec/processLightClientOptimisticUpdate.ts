import {IBeaconConfig} from "@lodestar/config";
import {altair, Slot} from "@lodestar/types";
import {LightClientStore} from "../types.js";
import {processLightClientUpdate} from "./processLightClientUpdate.js";
import {ZERO_FINALITY_BRANCH, ZERO_HEADER, ZERO_NEXT_SYNC_COMMITTEE_BRANCH, ZERO_SYNC_COMMITTEE} from "./utils.js";

export function processLightClientOptimisticUpdate(
  config: IBeaconConfig,
  store: LightClientStore,
  optimisticUpdate: altair.LightClientOptimisticUpdate,
  currentSlot: Slot
): void {
  const update: altair.LightClientUpdate = {
    attestedHeader: optimisticUpdate.attestedHeader,
    nextSyncCommittee: ZERO_SYNC_COMMITTEE,
    nextSyncCommitteeBranch: ZERO_NEXT_SYNC_COMMITTEE_BRANCH,
    finalizedHeader: ZERO_HEADER,
    finalityBranch: ZERO_FINALITY_BRANCH,
    syncAggregate: optimisticUpdate.syncAggregate,
    signatureSlot: optimisticUpdate.signatureSlot,
  };
  processLightClientUpdate(config, store, update, currentSlot);
}
