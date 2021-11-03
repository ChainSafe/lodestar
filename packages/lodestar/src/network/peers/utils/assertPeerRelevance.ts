import {computeStartSlotAtEpoch, getBlockRootAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {SLOTS_PER_HISTORICAL_ROOT} from "@chainsafe/lodestar-params";
import {Epoch, ForkDigest, Root, phase0, ssz} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";
import {toHexString} from "@chainsafe/ssz";
import {IBeaconChain} from "../../../chain";
import {GENESIS_EPOCH} from "../../../constants";

// TODO: Why this value? (From Lighthouse)
const FUTURE_SLOT_TOLERANCE = 1;

export enum IrrelevantPeerErrorCode {
  INCOMPATIBLE_FORKS = "IRRELEVANT_PEER_INCOMPATIBLE_FORKS",
  DIFFERENT_CLOCKS = "IRRELEVANT_PEER_DIFFERENT_CLOCKS",
  GENESIS_NONZERO = "IRRELEVANT_PEER_GENESIS_NONZERO",
  DIFFERENT_FINALIZED = "IRRELEVANT_PEER_DIFFERENT_FINALIZED",
}

type IrrelevantPeerErrorType =
  | {code: IrrelevantPeerErrorCode.INCOMPATIBLE_FORKS; ours: ForkDigest; theirs: ForkDigest}
  | {code: IrrelevantPeerErrorCode.DIFFERENT_CLOCKS; slotDiff: number}
  | {code: IrrelevantPeerErrorCode.GENESIS_NONZERO; root: string}
  | {code: IrrelevantPeerErrorCode.DIFFERENT_FINALIZED; expectedRoot: string; remoteRoot: string};

export class IrrelevantPeerError extends LodestarError<IrrelevantPeerErrorType> {}

/**
 * Process a `Status` message to determine if a peer is relevant to us. If the peer is
 * irrelevant the reason is returned.
 */
export function assertPeerRelevance(remote: phase0.Status, chain: IBeaconChain): void {
  const local = chain.getStatus();

  // The node is on a different network/fork
  if (!ssz.ForkDigest.equals(local.forkDigest, remote.forkDigest)) {
    throw new IrrelevantPeerError({
      code: IrrelevantPeerErrorCode.INCOMPATIBLE_FORKS,
      ours: local.forkDigest,
      theirs: remote.forkDigest,
    });
  }

  // The remote's head is on a slot that is significantly ahead of what we consider the
  // current slot. This could be because they are using a different genesis time, or that
  // their or our system's clock is incorrect.
  const slotDiff = remote.headSlot - Math.max(chain.clock.currentSlot, 0);
  if (slotDiff > FUTURE_SLOT_TOLERANCE) {
    throw new IrrelevantPeerError({code: IrrelevantPeerErrorCode.DIFFERENT_CLOCKS, slotDiff});
  }

  // TODO: Is this check necessary?
  if (remote.finalizedEpoch === GENESIS_EPOCH && !isZeroRoot(remote.finalizedRoot)) {
    throw new IrrelevantPeerError({
      code: IrrelevantPeerErrorCode.GENESIS_NONZERO,
      root: toHexString(remote.finalizedRoot),
    });
  }

  // The remote's finalized epoch is less than or equal to ours, but the block root is
  // different to the one in our chain. Therefore, the node is on a different chain and we
  // should not communicate with them.

  if (
    remote.finalizedEpoch <= local.finalizedEpoch &&
    !isZeroRoot(remote.finalizedRoot) &&
    !isZeroRoot(local.finalizedRoot)
  ) {
    const remoteRoot = remote.finalizedRoot;
    const expectedRoot =
      remote.finalizedEpoch === local.finalizedEpoch
        ? local.finalizedRoot
        : // This will get the latest known block at the start of the epoch.
          getRootAtHistoricalEpoch(chain, remote.finalizedEpoch);

    if (expectedRoot !== null && !ssz.Root.equals(remoteRoot, expectedRoot)) {
      throw new IrrelevantPeerError({
        code: IrrelevantPeerErrorCode.DIFFERENT_FINALIZED,
        expectedRoot: toHexString(expectedRoot), // forkChoice returns Tree BranchNode which the logger prints as {}
        remoteRoot: toHexString(remoteRoot),
      });
    }
  }

  // Note: Accept request status finalized checkpoint in the future, we do not know if it is a true finalized root
}

export function isZeroRoot(root: Root): boolean {
  const ZERO_ROOT = ssz.Root.defaultValue();
  return ssz.Root.equals(root, ZERO_ROOT);
}

function getRootAtHistoricalEpoch(chain: IBeaconChain, epoch: Epoch): Root | null {
  const headState = chain.getHeadState();
  const slot = computeStartSlotAtEpoch(epoch);

  if (slot < headState.slot - SLOTS_PER_HISTORICAL_ROOT) {
    // TODO: If the slot is very old, go to the historical blocks DB and fetch the block with less or equal `slot`.
    // Note that our db schema will have to be updated to persist the block root to prevent re-hashing.
    // For now peers will be accepted, since it's better than throwing an error on `getBlockRootAtSlot()`
    return null;
  }

  // This will get the latest known block at the start of the epoch.
  // NOTE: Throws if the epoch if from a long-ago epoch
  return getBlockRootAtSlot(headState, slot);

  // NOTE: Previous code tolerated long-ago epochs
  // ^^^^
  // finalized checkpoint of status is from an old long-ago epoch.
  // We need to ask the chain for most recent canonical block at the finalized checkpoint start slot.
  // The problem is that the slot may be a skip slot.
  // And the block root may be from multiple epochs back even.
  // The epoch in the checkpoint is there to checkpoint the tail end of skip slots, even if there is no block.
  // TODO: accepted for now. Need to maintain either a list of finalized block roots,
  // or inefficiently loop from finalized slot backwards, until we find the block we need to check against.
}
