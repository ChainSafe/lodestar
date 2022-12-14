import {IBeaconConfig} from "@lodestar/config";
import {altair, Slot} from "@lodestar/types";
import {processLightClientUpdate, ProcessUpdateOpts} from "./processLightClientUpdate.js";
import {ILightClientStore, LightClientStore} from "./store.js";
import {ZERO_FINALITY_BRANCH, ZERO_HEADER, ZERO_NEXT_SYNC_COMMITTEE_BRANCH, ZERO_SYNC_COMMITTEE} from "./utils.js";

export {isBetterUpdate, toLightClientUpdateSummary, LightClientUpdateSummary} from "./isBetterUpdate.js";

export class LightclientSpec {
  readonly store: ILightClientStore;

  constructor(config: IBeaconConfig, private readonly opts: ProcessUpdateOpts, bootstrap: altair.LightClientBootstrap) {
    this.store = new LightClientStore(config, bootstrap);
  }

  onUpdate(currentSlot: Slot, update: altair.LightClientUpdate): void {
    processLightClientUpdate(this.store, currentSlot, this.opts, update);
  }

  onFinalityUpdate(currentSlot: Slot, finalityUpdate: altair.LightClientFinalityUpdate): void {
    this.onUpdate(currentSlot, {
      attestedHeader: finalityUpdate.attestedHeader,
      nextSyncCommittee: ZERO_SYNC_COMMITTEE,
      nextSyncCommitteeBranch: ZERO_NEXT_SYNC_COMMITTEE_BRANCH,
      finalizedHeader: finalityUpdate.finalizedHeader,
      finalityBranch: finalityUpdate.finalityBranch,
      syncAggregate: finalityUpdate.syncAggregate,
      signatureSlot: finalityUpdate.signatureSlot,
    });
  }

  onOptimisticUpdate(currentSlot: Slot, optimisticUpdate: altair.LightClientOptimisticUpdate): void {
    this.onUpdate(currentSlot, {
      attestedHeader: optimisticUpdate.attestedHeader,
      nextSyncCommittee: ZERO_SYNC_COMMITTEE,
      nextSyncCommitteeBranch: ZERO_NEXT_SYNC_COMMITTEE_BRANCH,
      finalizedHeader: ZERO_HEADER,
      finalityBranch: ZERO_FINALITY_BRANCH,
      syncAggregate: optimisticUpdate.syncAggregate,
      signatureSlot: optimisticUpdate.signatureSlot,
    });
  }
}
