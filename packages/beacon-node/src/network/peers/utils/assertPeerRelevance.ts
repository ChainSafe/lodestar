import {ForkName, GENESIS_EPOCH, isForkPostFulu} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch, ForkDigest, Root, Slot, Status, fulu, ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";

// TODO: Why this value? (From Lighthouse)
const FUTURE_SLOT_TOLERANCE = 1;

export enum IrrelevantPeerCode {
  INCOMPATIBLE_FORKS = "IRRELEVANT_PEER_INCOMPATIBLE_FORKS",
  DIFFERENT_CLOCKS = "IRRELEVANT_PEER_DIFFERENT_CLOCKS",
  DIFFERENT_FINALIZED = "IRRELEVANT_PEER_DIFFERENT_FINALIZED",
  FINALIZED_EPOCH_TOO_HIGH = "IRRELEVANT_PEER_FINALIZED_EPOCH_TOO_HIGH",
  INVALID_FINALIZED_ROOT = "IRRELEVANT_PEER_INVALID_FINALIZED_ROOT",
  NO_EARLIEST_AVAILABLE_SLOT = "NO_EARLIEST_AVAILABLE_SLOT",
}

type IrrelevantPeerType =
  | {code: IrrelevantPeerCode.INCOMPATIBLE_FORKS; ours: ForkDigest; theirs: ForkDigest}
  | {code: IrrelevantPeerCode.DIFFERENT_CLOCKS; slotDiff: number}
  | {code: IrrelevantPeerCode.NO_EARLIEST_AVAILABLE_SLOT}
  | {code: IrrelevantPeerCode.FINALIZED_EPOCH_TOO_HIGH; finalizedEpoch: Epoch; maxFinalizedEpoch: Epoch}
  | {code: IrrelevantPeerCode.INVALID_FINALIZED_ROOT}
  | {code: IrrelevantPeerCode.DIFFERENT_FINALIZED; expectedRoot: Root; remoteRoot: Root};

/**
 * Process a `Status` message to determine if a peer is relevant to us. If the peer is
 * irrelevant the reason is returned.
 */
export function assertPeerRelevance(
  forkName: ForkName,
  remote: Status,
  local: Status,
  currentSlot: Slot
): IrrelevantPeerType | null {
  // The node is on a different network/fork
  if (!ssz.ForkDigest.equals(local.forkDigest, remote.forkDigest)) {
    return {
      code: IrrelevantPeerCode.INCOMPATIBLE_FORKS,
      ours: local.forkDigest,
      theirs: remote.forkDigest,
    };
  }

  // The remote's head is on a slot that is significantly ahead of what we consider the
  // current slot. This could be because they are using a different genesis time, or that
  // their or our system's clock is incorrect.
  const slotDiff = remote.headSlot - Math.max(currentSlot, 0);
  if (slotDiff > FUTURE_SLOT_TOLERANCE) {
    return {code: IrrelevantPeerCode.DIFFERENT_CLOCKS, slotDiff};
  }

  // A checkpoint can be finalized at the earliest at the start of epoch + 2
  const maxFinalizedEpoch = Math.max(
    GENESIS_EPOCH,
    computeEpochAtSlot(Math.max(currentSlot, 0) + FUTURE_SLOT_TOLERANCE) - 2
  );
  if (remote.finalizedEpoch > maxFinalizedEpoch) {
    return {
      code: IrrelevantPeerCode.FINALIZED_EPOCH_TOO_HIGH,
      finalizedEpoch: remote.finalizedEpoch,
      maxFinalizedEpoch,
    };
  }

  if (remote.finalizedEpoch > GENESIS_EPOCH && isZeroRoot(remote.finalizedRoot)) {
    return {code: IrrelevantPeerCode.INVALID_FINALIZED_ROOT};
  }

  // The remote's finalized epoch is equal to ours, but the block root is different to the one in our chain.
  // Therefore, the node is on a different chain and we should not communicate with them.
  if (
    remote.finalizedEpoch === local.finalizedEpoch &&
    !isZeroRoot(local.finalizedRoot) &&
    !ssz.Root.equals(remote.finalizedRoot, local.finalizedRoot)
  ) {
    return {
      code: IrrelevantPeerCode.DIFFERENT_FINALIZED,
      expectedRoot: local.finalizedRoot,
      remoteRoot: remote.finalizedRoot,
    };
  }

  if (isForkPostFulu(forkName) && (remote as fulu.Status).earliestAvailableSlot === undefined) {
    return {
      code: IrrelevantPeerCode.NO_EARLIEST_AVAILABLE_SLOT,
    };
  }

  // Note: for a behind finalized checkpoint, we validate it more on the main thread against our history,
  // see BeaconSync.verifyPastFinalizedCheckpoint
  return null;
}

export function isZeroRoot(root: Root): boolean {
  const ZERO_ROOT = ssz.Root.defaultValue();
  return ssz.Root.equals(root, ZERO_ROOT);
}

export function renderIrrelevantPeerType(type: IrrelevantPeerType): string {
  switch (type.code) {
    case IrrelevantPeerCode.INCOMPATIBLE_FORKS:
      return `INCOMPATIBLE_FORKS ours: ${toHex(type.ours)} theirs: ${toHex(type.theirs)}`;
    case IrrelevantPeerCode.DIFFERENT_CLOCKS:
      return `DIFFERENT_CLOCKS slotDiff: ${type.slotDiff}`;
    case IrrelevantPeerCode.DIFFERENT_FINALIZED:
      return `DIFFERENT_FINALIZED root: ${toRootHex(type.remoteRoot)} expected: ${toRootHex(type.expectedRoot)}`;
    case IrrelevantPeerCode.FINALIZED_EPOCH_TOO_HIGH:
      return `FINALIZED_EPOCH_TOO_HIGH finalizedEpoch: ${type.finalizedEpoch} max: ${type.maxFinalizedEpoch}`;
    case IrrelevantPeerCode.INVALID_FINALIZED_ROOT:
      return "INVALID_FINALIZED_ROOT zero root for a non-genesis finalized epoch";
    case IrrelevantPeerCode.NO_EARLIEST_AVAILABLE_SLOT:
      return "No earliestAvailableSlot announced via peer Status";
  }
}
