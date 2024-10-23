import {BeaconConfig} from "@lodestar/config";
import {UPDATE_TIMEOUT} from "@lodestar/params";
import {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  Slot,
} from "@lodestar/types";
import {computeSyncPeriodAtSlot} from "../utils/index.js";
import {getSyncCommitteeAtPeriod, processLightClientUpdate, ProcessUpdateOpts} from "./processLightClientUpdate.js";
import {ILightClientStore, LightClientStore, LightClientStoreEvents} from "./store.js";
import {ZERO_HEADER, ZERO_SYNC_COMMITTEE, getZeroFinalityBranch, getZeroSyncCommitteeBranch} from "./utils.js";

export {isBetterUpdate, toLightClientUpdateSummary} from "./isBetterUpdate.js";
export type {LightClientUpdateSummary} from "./isBetterUpdate.js";
export {upgradeLightClientHeader} from "./utils.js";

export class LightclientSpec {
  readonly store: ILightClientStore;
  readonly config: BeaconConfig;

  constructor(
    config: BeaconConfig,
    private readonly opts: ProcessUpdateOpts & LightClientStoreEvents,
    bootstrap: LightClientBootstrap
  ) {
    this.store = new LightClientStore(config, bootstrap, opts);
    this.config = config;
  }

  onUpdate(currentSlot: Slot, update: LightClientUpdate): void {
    processLightClientUpdate(this.config, this.store, currentSlot, this.opts, update);
  }

  onFinalityUpdate(currentSlot: Slot, finalityUpdate: LightClientFinalityUpdate): void {
    this.onUpdate(currentSlot, {
      attestedHeader: finalityUpdate.attestedHeader,
      nextSyncCommittee: ZERO_SYNC_COMMITTEE,
      nextSyncCommitteeBranch: getZeroSyncCommitteeBranch(this.config.getForkName(finalityUpdate.signatureSlot)),
      finalizedHeader: finalityUpdate.finalizedHeader,
      finalityBranch: finalityUpdate.finalityBranch,
      syncAggregate: finalityUpdate.syncAggregate,
      signatureSlot: finalityUpdate.signatureSlot,
    });
  }

  onOptimisticUpdate(currentSlot: Slot, optimisticUpdate: LightClientOptimisticUpdate): void {
    this.onUpdate(currentSlot, {
      attestedHeader: optimisticUpdate.attestedHeader,
      nextSyncCommittee: ZERO_SYNC_COMMITTEE,
      nextSyncCommitteeBranch: getZeroSyncCommitteeBranch(this.config.getForkName(optimisticUpdate.signatureSlot)),
      finalizedHeader: {beacon: ZERO_HEADER},
      finalityBranch: getZeroFinalityBranch(this.config.getForkName(optimisticUpdate.signatureSlot)),
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
