import {ForkDigest, Root, Slot, phase0, ssz} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";

// TODO: Why this value? (From Lighthouse)
const FUTURE_SLOT_TOLERANCE = 1;

export enum IrrelevantPeerCode {
  INCOMPATIBLE_FORKS = "IRRELEVANT_PEER_INCOMPATIBLE_FORKS",
  DIFFERENT_CLOCKS = "IRRELEVANT_PEER_DIFFERENT_CLOCKS",
  DIFFERENT_FINALIZED = "IRRELEVANT_PEER_DIFFERENT_FINALIZED",
}

type IrrelevantPeerType =
  | {code: IrrelevantPeerCode.INCOMPATIBLE_FORKS; ours: ForkDigest; theirs: ForkDigest}
  | {code: IrrelevantPeerCode.DIFFERENT_CLOCKS; slotDiff: number}
  | {code: IrrelevantPeerCode.DIFFERENT_FINALIZED; expectedRoot: Root; remoteRoot: Root};

/**
 * Process a `Status` message to determine if a peer is relevant to us. If the peer is
 * irrelevant the reason is returned.
 */
export function assertPeerRelevance(
  remote: phase0.Status,
  local: phase0.Status,
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

  // The remote's finalized epoch is less than or equal to ours, but the block root is
  // different to the one in our chain. Therefore, the node is on a different chain and we
  // should not communicate with them.

  if (
    remote.finalizedEpoch <= local.finalizedEpoch &&
    !isZeroRoot(remote.finalizedRoot) &&
    !isZeroRoot(local.finalizedRoot)
  ) {
    // NOTE: due to preferring to not access chain state here, we can't check the finalized root against our history.
    // The impact of not doing check is low: peers that are behind us we can't confirm they are in the same chain as us.
    // In the worst case they will attempt to sync from us, fail and disconnect. The ENR fork check should be sufficient
    // to differentiate most peers in normal network conditions.
    const remoteRoot = remote.finalizedRoot;
    const expectedRoot = remote.finalizedEpoch === local.finalizedEpoch ? local.finalizedRoot : null;

    if (expectedRoot !== null && !ssz.Root.equals(remoteRoot, expectedRoot)) {
      return {
        code: IrrelevantPeerCode.DIFFERENT_FINALIZED,
        expectedRoot: expectedRoot, // forkChoice returns Tree BranchNode which the logger prints as {}
        remoteRoot: remoteRoot,
      };
    }
  }

  // Note: Accept request status finalized checkpoint in the future, we do not know if it is a true finalized root
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
  }
}
