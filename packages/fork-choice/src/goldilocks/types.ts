import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";

/**
 * Goldilocks fork choice for EIP-8453 (Decoupled Consensus): the available chain (AC) is chosen by head votes
 * with a time-aware GHOST, locks keep voters from abandoning a confirmed block, and the finality gadget (FG)
 * frame restricts which branches may hold the head. There is no fork-choice.md on the spec branch yet; this
 * follows Francesco's Goldilocks paper and Terence's Prysm design note, adapted to the spec's committee votes.
 */

/** A head vote as the fork choice sees it: one validator, one slot, one (block, payload status) target */
export type HeadVoteSummary = {
  validator: ValidatorIndex;
  slot: Slot;
  root: RootHex;
  /** Spec numbering: PAYLOAD_STATUS_EMPTY 0, PAYLOAD_STATUS_FULL 1, PAYLOAD_STATUS_PENDING 2 */
  payloadStatus: number;
  /** Number of seats the validator holds in the head vote committee of `slot`; a validator sampled twice counts twice */
  seats: number;
};

/** A head vote carried in a block, with the proposer's support flag */
export type CarriedHeadVote = HeadVoteSummary & {supported: boolean};

/** The finality gadget summary of a block, read from its post-state */
export type FgSummary = {
  /** `state.target_checkpoint.height` */
  targetHeight: number;
  justified: {height: number; root: RootHex};
  finalized: {height: number; root: RootHex};
};

export type GoldilocksBlock = {
  root: RootHex;
  slot: Slot;
  parentRoot: RootHex;
  fg: FgSummary;
  headVotes: CarriedHeadVote[];
};

export type GoldilocksNode = {
  root: RootHex;
  slot: Slot;
  parent: GoldilocksNode | null;
  children: GoldilocksNode[];
  fg: FgSummary;
  /** When the store processed the block, ms since genesis */
  processedAt: number;
  /** Every head vote the block carried, for participation and equivocation */
  votes: HeadVoteSummary[];
  /** The carried votes the proposer marked as support */
  supported: HeadVoteSummary[];
};

export type Lock = {
  node: GoldilocksNode;
  /** ms since genesis after which the lock no longer vetoes or anchors */
  deadline: number;
};

export type GoldilocksOpts = {
  /** Slot duration, ms. Phases run at quarter-slot offsets (Δ = slotDurationMs / 4) */
  slotDurationMs: number;
  /** `HEAD_VOTE_COMMITTEE_SIZE`: support thresholds compare seat counts against half of it */
  committeeSize: number;
  /** First slot of the EIP-8453 fork; blocks before it, and up to the slot the store starts in, are always eligible */
  forkSlot: Slot;
  /** Slots a lock stays live after it is taken; the spec has not fixed this yet */
  lockTtlSlots?: number;
  /** Consecutive confirmation candidates whose common ancestor earns a slow lock; the spec has not fixed this yet */
  slowLockStreak?: number;
};

export type Duty = {
  voteSlot: Slot | null;
  vote: GoldilocksNode | null;
  fgSlot: Slot | null;
  fgSource: GoldilocksNode | null;
  fgHead: GoldilocksNode | null;
};

export type GoldilocksProposal = {
  parent: GoldilocksNode;
  /** Votes of the previous slot to carry, with the proposer's support judgement */
  headVotes: CarriedHeadVote[];
};
