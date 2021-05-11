import {sortBy} from "../../../util/sortBy";
import {MIN_FINALIZED_CHAIN_VALIDATED_EPOCHS, PARALLEL_HEAD_CHAINS} from "../../constants";
import {RangeSyncType} from "../../utils/remoteSyncType";
import {SyncChain} from "../chain";

/**
 * Priotize existing chains based on their target and peer count
 * Returns an array of chains toStart and toStop to comply with the priotization
 */
export function updateChains(chains: SyncChain[]): {toStart: SyncChain[]; toStop: SyncChain[]} {
  const finalizedChains: SyncChain[] = [];
  const headChains: SyncChain[] = [];
  for (const chain of chains) {
    if (chain.syncType === RangeSyncType.Finalized) {
      finalizedChains.push(chain);
    } else {
      headChains.push(chain);
    }
  }

  const toStart: SyncChain[] = [];
  const toStop: SyncChain[] = [];

  if (finalizedChains.length > 0) {
    // Pick first only
    const [newSyncChain] = prioritizeSyncChains(finalizedChains);

    // TODO: Should it stop all HEAD chains if going from a head sync to a finalized sync?

    const currentSyncChain = finalizedChains.find((syncChain) => syncChain.isSyncing);

    // Only switch from currentSyncChain to newSyncChain if necessary
    // Avoid unnecesary switchings and try to advance it
    if (
      !currentSyncChain ||
      (newSyncChain !== currentSyncChain &&
        newSyncChain.peers > currentSyncChain.peers &&
        currentSyncChain.validatedEpochs > MIN_FINALIZED_CHAIN_VALIDATED_EPOCHS)
    ) {
      toStart.push(newSyncChain);
      if (currentSyncChain) toStop.push(currentSyncChain);
    }
  } else {
    for (const syncChain of prioritizeSyncChains(headChains)) {
      if (toStart.length < PARALLEL_HEAD_CHAINS) {
        toStart.push(syncChain);
      } else {
        toStop.push(syncChain);
      }
    }
  }

  return {toStart, toStop};
}

/**
 * Order `syncChains` by most peers and already syncing first
 * If two chains have the same number of peers, prefer the already syncing to not drop progress
 */
function prioritizeSyncChains(syncChains: SyncChain[]): SyncChain[] {
  return sortBy(
    syncChains,
    (syncChain) => -syncChain.peers, // Sort from high peer count to low: negative to reverse
    (syncChain) => (syncChain.isSyncing ? 0 : 1) // Sort by isSyncing first = 0
  );
}
