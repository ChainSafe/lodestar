import {routes} from "@lodestar/api";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import type {IBeaconChain} from "../../chain/index.js";
import {SyncState} from "../../sync/index.js";
import {ApiError, NodeIsSyncing} from "./errors.js";

/**
 * If the node is within this many epochs from the head, we declare it to be synced regardless of
 * the network sync state.
 *
 * This helps prevent attacks where nodes can convince us that we're syncing some non-existent
 * finalized head.
 *
 * TODO: Lighthouse uses 8 for the attack described above. However, 8 kills Lodestar since validators
 * can trigger regen to fast-forward head state 8 epochs to be immediately invalidated as sync sets
 * a new head. Then the checkpoint state cache grows unbounded with very different states (because
 * they are 8 epochs apart) and causes an OOM. Research a proper solution once regen and the state
 * caches are better.
 */
export const SYNC_TOLERANCE_EPOCHS = 1;

/**
 * Reject any request while the node is syncing. Used by endpoints that must not serve while the
 * node is behind — validator duties, and beacon state lookups whose regen could otherwise walk
 * back past the block-root window (`SLOTS_PER_HISTORICAL_ROOT`) and wedge the node. Throws
 * {@link NodeIsSyncing} (503).
 */
export function notWhileSyncing(chain: IBeaconChain, syncState: SyncState): void {
  // Consider node synced before or close to genesis
  if (chain.clock.currentSlot < SLOTS_PER_EPOCH) {
    return;
  }

  switch (syncState) {
    case SyncState.SyncingFinalized:
    case SyncState.SyncingHead: {
      const currentSlot = chain.clock.currentSlot;
      const headSlot = chain.forkChoice.getHead().slot;
      if (currentSlot - headSlot > SYNC_TOLERANCE_EPOCHS * SLOTS_PER_EPOCH) {
        throw new NodeIsSyncing(`headSlot ${headSlot} currentSlot ${currentSlot}`);
      }

      return;
    }

    case SyncState.Synced:
      return;

    case SyncState.Stalled:
      throw new NodeIsSyncing("waiting for peers");
  }
}

/**
 * Ensures that the array contains unique values, and throws an ApiError
 * otherwise.
 * @param array - The array to check for uniqueness.
 * @param message - The message to put in the ApiError if the array contains
 * duplicates.
 */
export function assertUniqueItems(array: unknown[] | undefined, message: string): void {
  if (!array) {
    return;
  }

  const duplicateItems = array.reduce((partialDuplicateItems: unknown[], item, index) => {
    if (array.indexOf(item) !== index && !partialDuplicateItems.includes(item)) {
      return partialDuplicateItems.concat(item);
    }
    return partialDuplicateItems;
  }, []);

  if (duplicateItems.length) {
    throw new ApiError(400, `${message}: ${duplicateItems.join(", ")}`);
  }
}

export function toCheckpoint({rootHex, epoch}: CheckpointWithHex): routes.lodestar.Checkpoint {
  return {root: rootHex, epoch};
}
