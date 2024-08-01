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

  /** Run function when node status changes from syncing to synced */
  runOnResynced(fn: RunOnResyncedFn): void {
    this.fns.push(fn);
  }

  private checkSyncingStatus = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    try {
      const syncingStatus = (await this.api.node.getSyncingStatus()).value();

      if (this.prevSyncingStatus === undefined) {
        this.prevSyncingStatus = syncingStatus;
        return; // Initial check, do not run any handlers
      }

      const prevOfflineOrSyncing = this.prevSyncingStatus === null || this.prevSyncingStatus.isSyncing === true;

      if (prevOfflineOrSyncing && syncingStatus.isSyncing === false) {
        for (const fn of this.fns) {
          fn(slot, signal).catch((e) => this.logger.error("Error calling resynced event handler", e));
        }
      }

      if (syncingStatus.isSyncing === true) {
        this.logger.warn("Connected beacon node is syncing", {slot, ...syncingStatus});
      } else {
        this.logger.verbose("Connected beacon node is synced", {slot, ...syncingStatus});
      }

      this.prevSyncingStatus = syncingStatus;
    } catch (e) {
      this.logger.error("Failed to check syncing status", {}, e as Error);
      this.prevSyncingStatus = null;
    }
  };
}
