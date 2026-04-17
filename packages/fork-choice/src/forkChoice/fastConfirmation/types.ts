import {EffectiveBalanceIncrements, IBeaconStateView} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {ProtoBlock} from "../../protoArray/interface.ts";
import {CheckpointWithPayloadStatus} from "../store.ts";

export type FastConfirmationBalanceSource = {
  state: IBeaconStateView | null;
  balances: EffectiveBalanceIncrements;
  /**
   * Per-validator effective balance, pre-zeroed for both inactive and slashed
   * validators at the balance source epoch. Mirrors Lighthouse's `unslashed_balance`
   * and is the single filter used by the per-validator hot loop in
   * `precomputeChainAttestationScores` — removing all beacon-state access from
   * that path.
   *
   * When `state` is available at construction, this is populated via
   * `state.getEffectiveBalanceIncrementsZeroInactive()`, which zeros both
   * inactive and slashed entries. When `state` is null, this equals `balances`
   * (the fallback path's justified balances — inactive-zeroed but NOT
   * slashed-zeroed; matches the pre-existing null-state behavior of
   * `ensureVoteMaps`).
   */
  unslashedActiveBalances: EffectiveBalanceIncrements;
};

export type ForkChoiceStateGetter = (
  opts: {stateRoot: RootHex; checkpoint?: never} | {stateRoot?: never; checkpoint: CheckpointWithPayloadStatus}
) => IBeaconStateView | null;

type IFastConfirmationSpecStore = {
  confirmedRoot: RootHex;
  previousEpochObservedJustifiedCheckpoint: CheckpointWithPayloadStatus;
  currentEpochObservedJustifiedCheckpoint: CheckpointWithPayloadStatus;
  previousEpochGreatestUnrealizedCheckpoint: CheckpointWithPayloadStatus;
  previousSlotHead: RootHex;
  currentSlotHead: RootHex;
};

type IFastConfirmationAuxStore = {
  previousEpochObservedJustifiedBalances: EffectiveBalanceIncrements;
  currentEpochObservedJustifiedBalances: EffectiveBalanceIncrements;
  previousEpochGreatestUnrealizedBalances: EffectiveBalanceIncrements;
  stateGetter: ForkChoiceStateGetter;
};

export type IFastConfirmationStore = IFastConfirmationSpecStore & IFastConfirmationAuxStore;

export type FastConfirmationResult = {
  confirmedRoot: RootHex;
  didReset?: boolean;
};

export type FastConfirmationSnapshot = {
  currentSlot: Slot;
  currentEpoch: Epoch;
  headRoot: RootHex;
  confirmedRoot: RootHex;
  confirmedEpoch: Epoch | null;
  confirmedSlot: Slot | null;
  observedJustified: CheckpointWithPayloadStatus;
  headUnrealized: CheckpointWithPayloadStatus | null;
  finalizedRoot: RootHex;
};

export type FastConfirmationDecision = {
  confirmedRoot: RootHex;
  didReset: boolean;
  stop?: boolean;
  reason?: string;
};

export type FastConfirmationRule = (
  snapshot: FastConfirmationSnapshot,
  ctx: FastConfirmationContext,
  store: IFastConfirmationStore,
  cache: FastConfirmationCache,
  decision: FastConfirmationDecision,
  logger?: Logger
) => FastConfirmationDecision;

// This cache is created once per slot
export type FastConfirmationCache = {
  blockByRoot: Map<RootHex, ProtoBlock | null>;
  ancestorRoots: Map<string, RootHex[] | null>;
  committeeBySlot: Map<Slot, Set<ValidatorIndex>>;
  isDescendantByRootPair: Map<string, boolean>;
  /** voteRoot -> totalWeight, keyed by sourceKey ("current" | "previous") */
  voteWeightBySource: Map<string, Map<RootHex, number>>;
  headState?: IBeaconStateView;
  checkpointStateByKey: Map<string, IBeaconStateView | null>;
};

/**
 * Minimal read-only view of a ProtoArray node, sufficient for parent-walking
 * in `precomputeChainAttestationScores`. Narrowed from `ProtoNode` so mocks
 * can satisfy this shape without constructing a real ProtoArray.
 */
export type ProtoNodeReadView = {
  readonly parent?: number;
  readonly slot: Slot;
  readonly blockRoot: RootHex;
};

export type FastConfirmationContext = {
  config: {
    CONFIRMATION_BYZANTINE_THRESHOLD: number;
    PROPOSER_SCORE_BOOST: number;
  };
  getCurrentSlot(): Slot;
  getHead(): ProtoBlock;
  getBlock(root: RootHex): ProtoBlock | null;
  getAncestor(root: RootHex, slot: Slot): RootHex;
  isDescendant(ancestor: RootHex, descendant: RootHex): boolean;
  getLatestMessage(validatorIndex: ValidatorIndex): {root: RootHex; epoch: Epoch} | null;
  getUnrealizedJustified(): {checkpoint: CheckpointWithPayloadStatus; balances: EffectiveBalanceIncrements};
  getFinalizedCheckpoint(): CheckpointWithPayloadStatus;
  getEquivocatingIndices(): Set<ValidatorIndex>;
  getTrackedVotesCount(): number;

  /**
   * Returns all ProtoArray node indices for this root.
   * - Pre-Gloas: `[fullIdx]`
   * - Gloas, payload not yet observed: `[pendingIdx, emptyIdx]`
   * - Gloas, payload observed: `[pendingIdx, emptyIdx, fullIdx]`
   * - Unknown root: `[]`
   *
   * Used once per chain block by `precomputeChainAttestationScores` to build
   * the `indexToPosition` map covering every variant of each chain block.
   */
  getNodeIndices(root: RootHex): readonly number[];

  /**
   * Read-only view of ProtoArray nodes for parent-walking in the precompute
   * hot loop. Hoisted once at the top of `precomputeChainAttestationScores`
   * so the inner walk does plain array access with no function-call overhead
   * (walk runs up to O(V × depth) times per precompute invocation).
   */
  getProtoNodeView(): {readonly nodes: ReadonlyArray<ProtoNodeReadView>};

  /**
   * Read-only handle on `voteNextIndices`. Hoisted once at the top of
   * `precomputeChainAttestationScores` for direct indexed access in the
   * per-validator loop. `NULL_VOTE_INDEX` sentinel is preserved.
   */
  getVoteNextIndices(): readonly number[];
};

export interface IFastConfirmationRule {
  getConfirmedRoot(): RootHex;
  onSlotStartAfterPastAttestationsApplied(ctx: FastConfirmationContext): FastConfirmationResult;
}
