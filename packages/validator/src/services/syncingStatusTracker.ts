import {ApiClient, routes} from "@lodestar/api";
import {Logger} from "@lodestar/utils";
import {Slot} from "@lodestar/types";
import {IClock} from "../util/clock.js";

export type SyncingStatus = routes.node.SyncingStatus;

type RunOnResyncedFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

/**
 * Track the syncing status of connected beacon node
 */
export class SyncingStatusTracker {
  private prevSyncingStatus?: SyncingStatus | null;

  private readonly fns: RunOnResyncedFn[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly api: ApiClient,
    private readonly clock: IClock
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

  private checkSyncingStatus = async (currentSlot: Slot, signal: AbortSignal): Promise<void> => {
    try {
      const syncingStatus = (await this.api.node.getSyncingStatus()).value();

      if (this.prevSyncingStatus === undefined) {
        this.prevSyncingStatus = syncingStatus;
        return; // Initial check, do not run any handlers
      }

      const prevOfflineOrSyncing = this.prevSyncingStatus === null || this.prevSyncingStatus.isSyncing === true;

      if (prevOfflineOrSyncing && syncingStatus.isSyncing === false) {
        for (const fn of this.fns) {
          fn(currentSlot, signal).catch((e) => this.logger.error("Error calling resynced event handler", e));
        }
      }

      if (syncingStatus.isSyncing === true) {
        this.logger.warn("Node is syncing", {
          currentSlot,
          headSlot: syncingStatus.headSlot,
          syncDistance: syncingStatus.syncDistance,
        });
      } else if (prevOfflineOrSyncing) {
        this.logger.info("Node is synced", {
          currentSlot,
          headSlot: syncingStatus.headSlot,
        });
      }
      this.logger.verbose("Node syncing status", {currentSlot, ...syncingStatus});

      this.prevSyncingStatus = syncingStatus;
    } catch (e) {
      this.logger.error("Failed to check syncing status", {}, e as Error);
      // Error likely due to node being offline. In any case, handle failure to
      // check syncing status the same way as if node was previously syncing
      this.prevSyncingStatus = null;
    }
  };
}
