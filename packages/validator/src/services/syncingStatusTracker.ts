import {ApiClient, routes} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {BeaconHealth, Metrics} from "../metrics.js";
import {IClock} from "../util/clock.js";

export type SyncingStatus = routes.node.SyncingStatus;

type RunOnResyncedFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

/**
 * Track the syncing status of connected beacon node(s)
 */
export class SyncingStatusTracker {
  private prevSyncingStatus?: SyncingStatus | Error;

  private readonly fns: RunOnResyncedFn[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly api: ApiClient,
    private readonly clock: IClock,
    private readonly metrics: Metrics | null
  ) {
    this.clock.runEverySlot(this.checkSyncingStatus);
  }

  /**
   * Run function when node status changes from syncing to synced
   *
   * Note: does not consider if execution client is offline or syncing and
   * hence it is not useful to schedule tasks that require a non-optimistic node.
   */
  runOnResynced(fn: RunOnResyncedFn): void {
    this.fns.push(fn);
  }

  private checkSyncingStatus = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    try {
      const syncingStatus = (await this.api.node.getSyncingStatus()).value();
      const {isSyncing, headSlot, syncDistance, isOptimistic, elOffline} = syncingStatus;
      const prevErrorOrSyncing = this.prevSyncingStatus instanceof Error || this.prevSyncingStatus?.isSyncing === true;

      if (isSyncing === true) {
        this.logger.warn("Node is syncing", {slot, headSlot, syncDistance});
      } else if (this.prevSyncingStatus === undefined || prevErrorOrSyncing) {
        this.logger.info("Node is synced", {slot, headSlot, isOptimistic, elOffline});
      }
      this.logger.verbose("Node syncing status", {slot, ...syncingStatus});

      this.prevSyncingStatus = syncingStatus;

      this.metrics?.beaconHealth.set(
        !isSyncing && !isOptimistic && !elOffline ? BeaconHealth.READY : BeaconHealth.SYNCING
      );

      if (prevErrorOrSyncing && isSyncing === false) {
        await Promise.all(
          this.fns.map((fn) =>
            fn(slot, signal).catch((e) => this.logger.error("Error calling resynced event handler", e))
          )
        );
      }
    } catch (e) {
      // Error likely due to node being offline. In any case, handle failure to
      // check syncing status the same way as if node was previously syncing
      this.prevSyncingStatus = e as Error;

      this.metrics?.beaconHealth.set(BeaconHealth.ERROR);

      this.logger.error("Failed to check syncing status", {slot}, this.prevSyncingStatus);
    }
  };
}
