import {IForkChoice} from "@lodestar/fork-choice";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {phase0, Slot} from "@lodestar/types";
import {ChainTarget} from "../range/utils/index.js";

/** The type of peer relative to our current state */
export enum PeerSyncType {
  /** The peer is on our chain and is fully synced with respect to our chain */
  FullySynced = "FullySynced",
  /** The peer has a greater knowledge of the chain than us that warrants a full sync */
  Advanced = "Advanced",
  /** A peer is behind in the sync and not useful to us for downloading blocks */
  Behind = "Behind",
}

// Cache Object.keys iteration for faster loops in metrics
export const peerSyncTypes = Object.keys(PeerSyncType) as PeerSyncType[];

function withinRangeOf(value: number, target: number, range: number): boolean {
  return value >= target - range && value <= target + range;
}

export function getPeerSyncType(
  local: phase0.Status,
  remote: phase0.Status,
  forkChoice: IForkChoice,
  slotImportTolerance: number
): PeerSyncType {
  // Aux vars: Inclusive boundaries of the range to consider a peer's head synced to ours.
  const nearRangeStart = local.headSlot - slotImportTolerance;
  const nearRangeEnd = local.headSlot + slotImportTolerance;

  if (remote.finalizedEpoch < local.finalizedEpoch) {
    // The node has a lower finalized epoch, their chain is not useful to us. There are two
    // cases where a node can have a lower finalized epoch:
    //
    // ## The node is on the same chain
    //
    // If a node is on the same chain but has a lower finalized epoch, their head must be
    // lower than ours. Therefore, we have nothing to request from them.
    //
    // ## The node is on a fork
    //
    // If a node is on a fork that has a lower finalized epoch, switching to that fork would
    // cause us to revert a finalized block. This is not permitted, therefore we have no
    // interest in their blocks.
    //
    // We keep these peers to allow them to sync from us.
    return PeerSyncType.Behind;
  }

  //
  else if (remote.finalizedEpoch > local.finalizedEpoch) {
    if (
      // Peer is in next epoch, and head is within range => SYNCED
      (local.finalizedEpoch + 1 === remote.finalizedEpoch &&
        withinRangeOf(remote.headSlot, local.headSlot, slotImportTolerance)) ||
      // Peer's head is known => SYNCED
      forkChoice.hasBlock(remote.headRoot)
    ) {
      return PeerSyncType.FullySynced;
    } else {
      return PeerSyncType.Advanced;
    }
  }

  // remote.finalizedEpoch == local.finalizedEpoch
  else {
    // NOTE: if a peer has our same `finalizedEpoch` with a different `finalized_root`
    // they are not considered relevant and won't be propagated to sync.
    // Check if the peer is the peer is inside the tolerance range to be considered synced.
    if (remote.headSlot < nearRangeStart) {
      return PeerSyncType.Behind;
    } else if (remote.headSlot > nearRangeEnd && !forkChoice.hasBlock(remote.headRoot)) {
      // This peer has a head ahead enough of ours and we have no knowledge of their best block.
      return PeerSyncType.Advanced;
    } else {
      // This peer is either in the tolerance range, or ahead us with an already rejected block.
      return PeerSyncType.FullySynced;
    }
  }
}

export enum RangeSyncType {
  /** A finalized chain sync should be started with this peer */
  Finalized = "Finalized",
  /** A head chain sync should be started with this peer */
  Head = "Head",
}

// Cache Object.keys iteration for faster loops in metrics
export const rangeSyncTypes = Object.keys(RangeSyncType) as RangeSyncType[];

/**
 * Check if a peer requires a finalized chain sync. Only if:
 * - The remotes finalized epoch is greater than our current finalized epoch and we have
 *   not seen the finalized hash before
 */
export function getRangeSyncType(local: phase0.Status, remote: phase0.Status, forkChoice: IForkChoice): RangeSyncType {
  if (remote.finalizedEpoch > local.finalizedEpoch && !forkChoice.hasBlock(remote.finalizedRoot)) {
    return RangeSyncType.Finalized;
  } else {
    return RangeSyncType.Head;
  }
}

export function getRangeSyncTarget(
  local: phase0.Status,
  remote: phase0.Status,
  forkChoice: IForkChoice
): {syncType: RangeSyncType; startEpoch: Slot; target: ChainTarget} {
  if (remote.finalizedEpoch > local.finalizedEpoch && !forkChoice.hasBlock(remote.finalizedRoot)) {
    return {
      // If  RangeSyncType.Finalized, the range of blocks fetchable from startEpoch and target must allow to switch
      // to RangeSyncType.Head
      //
      // finalizedRoot is a block with slot <= computeStartSlotAtEpoch(finalizedEpoch).
      // If finalizedEpoch does not start with a skipped slot, the SyncChain with this target MUST process the
      // first block of the next epoch in order to trigger the condition above `forkChoice.hasBlock(remote.finalizedRoot)`
      // and do a Head sync.
      //
      // When doing a finalized sync, we'll process blocks up to the finalized checkpoint, which does not allow to
      // finalize that checkpoint. Instead, our head will be the finalized checkpoint and our finalized checkpoint will
      // be some older checkpoint. After completing a finalized SyncChain:
      //
      // (== finalized, -- non-finalized)
      // Remote  ====================================================|----------------|
      // Local   =====================================|--------------|

      syncType: RangeSyncType.Finalized,
      startEpoch: local.finalizedEpoch,
      target: {
        slot: computeStartSlotAtEpoch(remote.finalizedEpoch),
        root: remote.finalizedRoot,
      },
    };
  } else {
    return {
      syncType: RangeSyncType.Head,
      // The new peer has the same finalized (earlier filters should prevent a peer with an
      // earlier finalized chain from reaching here).
      startEpoch: Math.min(computeEpochAtSlot(local.headSlot), remote.finalizedEpoch),
      target: {
        slot: remote.headSlot,
        root: remote.headRoot,
      },
    };
  }
}
