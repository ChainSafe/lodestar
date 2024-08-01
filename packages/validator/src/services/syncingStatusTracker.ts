import {ApiClient, routes} from "@lodestar/api";
import {Logger} from "@lodestar/utils";
import {Slot} from "@lodestar/types";
import {IClock} from "../util/clock.js";

export type SyncingStatus = routes.node.SyncingStatus;

type RunOnSyncedFn = (slot: Slot, signal: AbortSignal) => Promise<void>;

/**
 * Track the syncing status of connected beacon node
 */
export class SyncingStatusTracker {
  private prevSyncingStatus: SyncingStatus | null = null;

  private readonly fns: RunOnSyncedFn[] = [];

  constructor(
    private readonly logger: Logger,
    private readonly api: ApiClient,
    private readonly clock: IClock
  ) {
    this.clock.runEverySlot(this.checkSyncingStatus);
  }

  /** Run function when node status changes from syncing to synced */
  runOnSynced(fn: RunOnSyncedFn): void {
    this.fns.push(fn);
  }

  private checkSyncingStatus = async (slot: Slot, signal: AbortSignal): Promise<void> => {
    try {
      const syncingStatus = (await this.api.node.getSyncingStatus()).value();

      if (this.prevSyncingStatus === null) {
        // Initial check, do not run any handlers
        this.prevSyncingStatus = syncingStatus;
      } else {
        if (this.prevSyncingStatus.isSyncing === true && syncingStatus.isSyncing === false) {
          for (const fn of this.fns) {
            fn(slot, signal).catch((e) => this.logger.error("Error calling sync event handler", e));
          }
        }
        this.prevSyncingStatus = syncingStatus;
      }

      if (syncingStatus.isSyncing === true) {
        this.logger.warn("Connected beacon node is syncing", {slot, ...syncingStatus});
      } else {
        this.logger.debug("Connected beacon node is synced", {slot, ...syncingStatus});
      }
    } catch (e) {
      this.logger.error("Failed to check syncing status", {}, e as Error);
      if (this.prevSyncingStatus) {
        // Error likely due to node being offline, after restart it will be syncing
        this.prevSyncingStatus.isSyncing = true;
      }
    }
  };
}
