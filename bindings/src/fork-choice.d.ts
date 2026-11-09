import type {BeaconConfig} from "./index.js";

/** Spec `PayloadStatus`; a node id is `blockIndex * 3 + payloadStatus`. */
export declare enum PayloadStatus {
  Empty = 0,
  Full = 1,
  Pending = 2,
}

/** The engine's verdict on a payload, ordered so the worse status has the higher value. */
export declare enum ExecutionStatus {
  PreMerge = 0,
  Valid = 1,
  Syncing = 2,
  Invalid = 3,
}

/** Node id of no node, as reported by `bestChildren` and `latestMessages`. */
export declare const NO_NODE: number;
/** Block index of a block dropped by `prune`. */
export declare const NO_BLOCK: number;

export interface Checkpoint {
  epoch: number;
  root: Uint8Array;
}

/** What spec `on_block` reads from a block and its post-state. */
export interface BlockSummary {
  root: Uint8Array;
  parentRoot: Uint8Array;
  slot: number;
  proposerIndex: number;
  stateRoot: Uint8Array;
  /** Post-state `current_justified_checkpoint` */
  justifiedCheckpoint: Checkpoint;
  /** Post-state `finalized_checkpoint` */
  finalizedCheckpoint: Checkpoint;
  /** Spec `compute_pulled_up_tip`: the post-state after `process_justification_and_finalization` */
  unrealizedJustifiedCheckpoint: Checkpoint;
  unrealizedFinalizedCheckpoint: Checkpoint;
  /** The block's own payload: the execution payload's hash before Gloas, the bid's from Gloas on. Omitted before the merge */
  payloadBlockHash?: Uint8Array;
  /** Gloas bid `parent_block_hash` */
  bidParentBlockHash?: Uint8Array;
  /** `PreMerge` iff the block has no payload, `Syncing` for a Gloas block with a bid */
  executionStatus: ExecutionStatus;
  /** Milliseconds into the block's slot at which it arrived. Defaults to the store's time */
  arrivalMsIntoSlot?: number;
}

export interface AttestationData {
  slot: number;
  index: number;
  beaconBlockRoot: Uint8Array;
  source: Checkpoint;
  target: Checkpoint;
}

/**
 * Answers from beacon states, which the store does not hold. Both run synchronously inside the
 * call that needs them and must not throw for a checkpoint or block the store was just given.
 */
export interface StateProvider {
  /** Effective balance increments of the checkpoint state, inactive and slashed validators zeroed */
  justifiedBalances(epoch: number, root: Uint8Array): Uint16Array;
  /** Members of every beacon committee of `slot` in the state of block `root` */
  slotCommitteeMembers(root: Uint8Array, slot: number): Uint32Array;
}

export type KeepHeadReason =
  | "head_timely"
  | "shuffling_not_stable"
  | "not_ffg_competitive"
  | "finalization_not_ok"
  | "parent_not_previous_slot"
  | "not_proposing_on_time"
  | "not_proposing_next_slot"
  | "proposer_boost_not_worn_off"
  | "head_not_weak"
  | "parent_not_strong";

/**
 * The Zig fork choice store. It owns the block tree and every decision; blocks are addressed by
 * block index and fork choice nodes by node id (`blockIndex * 3 + payloadStatus`), both stable
 * until `prune`. Failed calls throw an `Error` whose `code` is the Zig error name.
 */
export declare class ForkChoice {
  /** `anchor.slot` is the anchor state's slot and its checkpoints are that state's */
  constructor(config: BeaconConfig, genesisTime: number, anchor: BlockSummary, provider: StateProvider);

  readonly timeMs: number;
  readonly currentSlot: number;
  readonly blockCount: number;
  /** Validators the store has a latest message slot for */
  readonly voteCount: number;
  readonly queuedVoteCount: number;
  readonly equivocatingCount: number;
  /** Validators whose vote or weight the head computation re-checked or first counted, summed over every run */
  readonly voteChangesTotal: number;
  readonly proposerBoostRoot: Uint8Array;
  /** Total active unslashed balance of the justified state in Gwei */
  readonly justifiedTotalBalance: bigint;

  /** Spec `compute_time_at_slot_ms` */
  timeAtSlotMs(slot: number): number;
  /** Spec `on_tick`. Time does not run backwards: an earlier time is ignored */
  onTick(timeMs: number): void;

  /** Spec `on_block`. Returns the block's index */
  onBlock(block: BlockSummary): number;
  /** Spec `on_attestation` for an attestation verified against its target state */
  onAttestation(
    slot: number,
    index: number,
    beaconBlockRoot: Uint8Array,
    targetEpoch: number,
    targetRoot: Uint8Array,
    attestingIndices: Uint32Array,
    isFromBlock: boolean
  ): void;
  /** Spec `on_attester_slashing`; both index lists sorted ascending */
  onAttesterSlashing(
    data1: AttestationData,
    indices1: Uint32Array,
    data2: AttestationData,
    indices2: Uint32Array
  ): void;
  /** Spec `notify_ptc_messages` for one indexed payload attestation; `positions` are the PTC positions that voted */
  onPtcVotes(
    beaconBlockRoot: Uint8Array,
    slot: number,
    positions: Uint16Array,
    payloadPresent: boolean,
    blobDataAvailable: boolean
  ): void;
  /** Spec `on_execution_payload_envelope` for a verified envelope */
  onExecutionPayload(
    beaconBlockRoot: Uint8Array,
    executionStatus: ExecutionStatus,
    inclusionListSatisfied?: boolean
  ): void;
  /** Returns whether the verdict changed */
  recordInclusionListSatisfaction(blockIndex: number, satisfied: boolean): boolean;
  /** The recorded engine verdict, `undefined` when there is none */
  inclusionListSatisfaction(blockIndex: number): boolean | undefined;
  isPayloadInclusionListSatisfied(blockIndex: number): boolean;
  /** Optimistic sync: the payload with `blockHash` and those below it are valid */
  onPayloadValid(blockHash: Uint8Array): void;
  /** Optimistic sync: the engine rejected a block on `parentRoot` whose payload builds on `parentBlockHash` */
  onPayloadInvalid(parentRoot: Uint8Array, parentBlockHash: Uint8Array, latestValidHash?: Uint8Array): void;
  /** New index of each old block index (`NO_BLOCK` when dropped), `undefined` when nothing was dropped */
  prune(): Uint32Array | undefined;

  /** Spec `get_head` as a node id */
  getHead(): number;
  /** Spec `get_proposer_head`: the node id to build on when the head is reorged out, else why it is kept */
  getProposerHead(headNode: number, slot: number): number | KeepHeadReason;
  isHeadWeak(blockIndex: number): boolean;
  /** Spec `is_parent_strong` for the parent of the block */
  isParentStrong(blockIndex: number): boolean;
  isProposerEquivocation(blockIndex: number): boolean;
  /** Spec `get_weight` per node id, in Gwei */
  weights(): BigUint64Array;
  /** Spec `get_attestation_score` per node id, in Gwei */
  attestationScores(): BigUint64Array;
  /** Best child of each node id, `NO_NODE` without a viable child */
  bestChildren(): Uint32Array;
  /** Worst engine verdict on the payloads each node id stands on */
  executionStatuses(): Uint8Array;
  viableHeads(): {root: Uint8Array; payloadStatus: PayloadStatus; weight: bigint}[];

  checkpoints(): {
    justified: Checkpoint;
    finalized: Checkpoint;
    unrealizedJustified: Checkpoint;
    unrealizedFinalized: Checkpoint;
  };
  blockIndex(root: Uint8Array): number | undefined;
  /** Node id the block's `pending` node hangs from, `undefined` for the root block */
  parentNode(blockIndex: number): number | undefined;
  /** Spec `get_ancestor` on node ids */
  getAncestor(node: number, slot: number): number;
  isFinalizedDescendant(blockIndex: number): boolean;
  /** Spec `store.block_timeliness[root]` */
  blockTimeliness(blockIndex: number): [proposerTimely: boolean, ptcTimely: boolean];
  /** One byte per PTC position: bit 0 voted, bit 1 payload present, bit 2 blob data available */
  ptcVotes(blockIndex: number): Uint8Array;
  /** Spec `should_extend_payload`. Throws unless the block is from the slot before the store's */
  shouldExtendPayload(blockIndex: number): boolean;
  /** Spec `should_build_on_full` for an `Empty` or `Full` head node */
  shouldBuildOnFull(headNode: number, slot: number): boolean;
  /** Each validator's latest message: its slot (`NaN` for none) and the node id it counts on (`NO_NODE` for none) */
  latestMessages(): {slots: Float64Array; nodes: Uint32Array};
}
