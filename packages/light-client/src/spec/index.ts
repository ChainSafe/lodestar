import {BeaconConfig} from "@lodestar/config";
import {UPDATE_TIMEOUT} from "@lodestar/params";
import {Slot, allForks} from "@lodestar/types";
import {computeSyncPeriodAtSlot} from "../utils/index.js";
import {getSyncCommitteeAtPeriod, processLightClientUpdate, ProcessUpdateOpts} from "./processLightClientUpdate.js";
import {ILightClientStore, LightClientStore, LightClientStoreEvents} from "./store.js";
import {ZERO_FINALITY_BRANCH, ZERO_HEADER, ZERO_NEXT_SYNC_COMMITTEE_BRANCH, ZERO_SYNC_COMMITTEE} from "./utils.js";

export {isBetterUpdate, toLightClientUpdateSummary, LightClientUpdateSummary} from "./isBetterUpdate.js";
export {upgradeLightClientHeader} from "./utils.js";

export class LightclientSpec {
  readonly store: ILightClientStore;

  constructor(
    config: BeaconConfig,
    private readonly opts: ProcessUpdateOpts & LightClientStoreEvents,
    bootstrap: allForks.LightClientBootstrap
  ) {
    this.store = new LightClientStore(config, bootstrap, opts);
  }

  onUpdate(currentSlot: Slot, update: allForks.LightClientUpdate): void {
    processLightClientUpdate(this.store, currentSlot, this.opts, update);
  }

  onFinalityUpdate(currentSlot: Slot, finalityUpdate: allForks.LightClientFinalityUpdate): void {
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

  onOptimisticUpdate(currentSlot: Slot, optimisticUpdate: allForks.LightClientOptimisticUpdate): void {
    this.onUpdate(currentSlot, {
      attestedHeader: optimisticUpdate.attestedHeader,
      nextSyncCommittee: ZERO_SYNC_COMMITTEE,
      nextSyncCommitteeBranch: ZERO_NEXT_SYNC_COMMITTEE_BRANCH,
      finalizedHeader: {beacon: ZERO_HEADER},
      finalityBranch: ZERO_FINALITY_BRANCH,
      syncAggregate: optimisticUpdate.syncAggregate,
      signatureSlot: optimisticUpdate.signatureSlot,
    });
  }

  forceUpdate(currentSlot: Slot): void {
    for (const bestValidUpdate of this.store.bestValidUpdates.values()) {
      if (currentSlot > bestValidUpdate.update.finalizedHeader.beacon.slot + UPDATE_TIMEOUT) {
        const updatePeriod = computeSyncPeriodAtSlot(bestValidUpdate.update.signatureSlot);
        // Simulate process_light_client_store_force_update() by forcing to apply a bestValidUpdate
        // https://github.com/ethereum/consensus-specs/blob/a57e15636013eeba3610ff3ade41781dba1bb0cd/specs/altair/light-client/sync-protocol.md?plain=1#L394
        // Call for `updatePeriod + 1` to force the update at `update.signatureSlot` to be applied
        getSyncCommitteeAtPeriod(this.store, updatePeriod + 1, this.opts);
      }
    }
  }
}
