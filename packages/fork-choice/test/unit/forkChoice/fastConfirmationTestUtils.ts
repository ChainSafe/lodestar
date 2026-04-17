import {fromHexString} from "@chainsafe/ssz";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {
  FastConfirmationContext,
  FastConfirmationSnapshot,
  IFastConfirmationStore,
} from "../../../src/forkChoice/fastConfirmation/types.js";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "../../../src/index.js";
import {NULL_VOTE_INDEX} from "../../../src/protoArray/interface.js";

export const ZERO_ROOT = rootFromNumber(0);

export function rootFromNumber(n: number): RootHex {
  return `0x${n.toString(16).padStart(64, "0")}`;
}

export function checkpoint(
  epoch: Epoch,
  rootHex: RootHex,
  payloadStatus: PayloadStatus = PayloadStatus.FULL
): {epoch: Epoch; root: Uint8Array; rootHex: RootHex; payloadStatus: PayloadStatus} {
  return {epoch, root: fromHexString(rootHex), rootHex, payloadStatus};
}

export function makeBlock(
  slot: number,
  parentRoot: RootHex,
  opts: Partial<
    Pick<
      ProtoBlock,
      "blockRoot" | "justifiedEpoch" | "justifiedRoot" | "unrealizedJustifiedEpoch" | "unrealizedJustifiedRoot"
    >
  > = {}
): ProtoBlock {
  const blockRoot = opts.blockRoot ?? rootFromNumber(slot);
  return {
    slot: slot as Slot,
    blockRoot,
    parentRoot,
    stateRoot: blockRoot,
    targetRoot: blockRoot,
    justifiedEpoch: opts.justifiedEpoch ?? 0,
    justifiedRoot: opts.justifiedRoot ?? ZERO_ROOT,
    finalizedEpoch: 0,
    finalizedRoot: ZERO_ROOT,
    unrealizedJustifiedEpoch: opts.unrealizedJustifiedEpoch ?? 0,
    unrealizedJustifiedRoot: opts.unrealizedJustifiedRoot ?? ZERO_ROOT,
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: ZERO_ROOT,
    executionPayloadBlockHash: null,
    executionStatus: ExecutionStatus.PreMerge,
    dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    parentBlockHash: null,
    payloadStatus: PayloadStatus.FULL,
    timeliness: false,
  };
}

export function makeState(
  validatorCount: number,
  balancePerValidator: number,
  committeeSlots: Slot[],
  slashedIndices: ValidatorIndex[] = []
): IBeaconStateView {
  const balances = new Uint16Array(Array.from({length: validatorCount}, () => balancePerValidator));
  const activeIndices = Uint32Array.from(Array.from({length: validatorCount}, (_, i) => i as ValidatorIndex));
  const slashed = new Set<ValidatorIndex>(slashedIndices);
  const committees = new Map<Slot, Uint32Array>(committeeSlots.map((slot) => [slot, activeIndices]));

  return {
    slot: (committeeSlots.length > 0 ? Math.max(...committeeSlots) : 0) as Slot,
    epoch: 0,
    effectiveBalanceIncrements: balances,
    getEffectiveBalanceIncrementsZeroInactive: () => balances,
    getCurrentShuffling: () => ({activeIndices}) as {activeIndices: Uint32Array},
    getBeaconCommitteeCountPerSlot: () => 1,
    getBeaconCommittee: (slot: Slot) => committees.get(slot) ?? activeIndices,
    getValidator: (index: ValidatorIndex) => ({
      slashed: slashed.has(index),
      activationEpoch: 0,
      exitEpoch: FAR_FUTURE_EPOCH,
    }),
    validatorCount,
  } as unknown as IBeaconStateView;
}

export function makeStore(
  confirmedRoot: RootHex,
  previousObservedRoot: RootHex,
  currentObservedRoot: RootHex,
  previousObservedEpoch: Epoch,
  currentObservedEpoch: Epoch,
  previousSlotHead: RootHex,
  currentSlotHead: RootHex,
  state: IBeaconStateView,
  opts: {
    previousGreatestUnrealizedRoot?: RootHex;
    previousGreatestUnrealizedEpoch?: Epoch;
    previousObservedBalances?: Uint16Array;
    currentObservedBalances?: Uint16Array;
    previousGreatestUnrealizedBalances?: Uint16Array;
  } = {}
): IFastConfirmationStore {
  const balances = state.effectiveBalanceIncrements;
  return {
    previousEpochObservedJustifiedCheckpoint: checkpoint(previousObservedEpoch, previousObservedRoot),
    currentEpochObservedJustifiedCheckpoint: checkpoint(currentObservedEpoch, currentObservedRoot),
    previousEpochGreatestUnrealizedCheckpoint: checkpoint(
      opts.previousGreatestUnrealizedEpoch ?? currentObservedEpoch,
      opts.previousGreatestUnrealizedRoot ?? currentObservedRoot
    ),
    confirmedRoot,
    previousEpochObservedJustifiedBalances: opts.previousObservedBalances ?? balances,
    currentEpochObservedJustifiedBalances: opts.currentObservedBalances ?? balances,
    previousEpochGreatestUnrealizedBalances:
      opts.previousGreatestUnrealizedBalances ?? opts.currentObservedBalances ?? balances,
    previousSlotHead,
    currentSlotHead,
    stateGetter: () => state,
  };
}

export function makeContext(
  currentSlot: Slot,
  headRoot: RootHex,
  blocks: ProtoBlock[],
  latestMessages: Map<ValidatorIndex, {root: RootHex; epoch: Epoch}>,
  unrealizedCheckpoint: {epoch: Epoch; rootHex: RootHex},
  state: IBeaconStateView,
  equivocatingIndices: ValidatorIndex[] = [],
  unrealizedBalances: Uint16Array = state.effectiveBalanceIncrements
): FastConfirmationContext {
  const blocksByRoot = new Map(blocks.map((block) => [block.blockRoot, block]));
  const equivocating = new Set(equivocatingIndices);

  // Build a fake ProtoArray-like structure so the three new accessors can
  // satisfy `precomputeChainAttestationScores` without a real ProtoArray.
  // Assumes `blocks` is in topological order (ancestors before descendants),
  // which all existing fixtures satisfy.
  const nodeIndexByRoot = new Map<RootHex, number>();
  const protoNodes: {readonly parent?: number; readonly slot: Slot; readonly blockRoot: RootHex}[] = [];
  for (const block of blocks) {
    const parentIdx = nodeIndexByRoot.get(block.parentRoot);
    const idx = protoNodes.length;
    protoNodes.push({parent: parentIdx, slot: block.slot, blockRoot: block.blockRoot});
    nodeIndexByRoot.set(block.blockRoot, idx);
  }

  // voteNextIndices: one entry per validator. Derive from latestMessages —
  // validators without a latest message (or voting for a block we don't know
  // about) get NULL_VOTE_INDEX.
  const validatorCount = state.effectiveBalanceIncrements.length;
  const voteNextIndices = new Array<number>(validatorCount).fill(NULL_VOTE_INDEX);
  for (const [vIdx, msg] of latestMessages) {
    const nodeIdx = nodeIndexByRoot.get(msg.root);
    if (nodeIdx !== undefined && vIdx < validatorCount) {
      voteNextIndices[vIdx] = nodeIdx;
    }
  }

  return {
    config: {
      CONFIRMATION_BYZANTINE_THRESHOLD: 25,
      PROPOSER_SCORE_BOOST: 40,
    },
    getCurrentSlot: () => currentSlot,
    getHead: () => blocksByRoot.get(headRoot) ?? nullBlock(headRoot),
    getBlock: (root: RootHex) => blocksByRoot.get(root) ?? null,
    getAncestor: (root: RootHex, slot: Slot) => {
      let current = blocksByRoot.get(root);
      while (current && current.slot > slot) {
        current = blocksByRoot.get(current.parentRoot);
      }
      if (!current || current.slot !== slot) {
        throw new Error(`ancestor not found for ${root} at slot ${slot}`);
      }
      return current.blockRoot;
    },
    isDescendant: (ancestor: RootHex, descendant: RootHex) => {
      let current = blocksByRoot.get(descendant);
      while (current) {
        if (current.blockRoot === ancestor) return true;
        if (current.blockRoot === ZERO_ROOT) return false;
        current = blocksByRoot.get(current.parentRoot);
      }
      return false;
    },
    getLatestMessage: (validatorIndex: ValidatorIndex) => latestMessages.get(validatorIndex) ?? null,
    getUnrealizedJustified: () => ({
      checkpoint: checkpoint(unrealizedCheckpoint.epoch, unrealizedCheckpoint.rootHex),
      balances: unrealizedBalances,
    }),
    getFinalizedCheckpoint: () => checkpoint(0, ZERO_ROOT),
    getEquivocatingIndices: () => equivocating,
    getTrackedVotesCount: () => latestMessages.size,
    getNodeIndices: (root: RootHex) => {
      const idx = nodeIndexByRoot.get(root);
      return idx === undefined ? [] : [idx];
    },
    getProtoNodeView: () => ({nodes: protoNodes}),
    getVoteNextIndices: () => voteNextIndices,
  };
}

export function makeSnapshot(
  currentSlot: Slot,
  currentEpoch: Epoch,
  headRoot: RootHex,
  confirmedRoot: RootHex,
  confirmedSlot: Slot | null,
  confirmedEpoch: Epoch | null,
  finalizedRoot: RootHex,
  observedJustifiedRoot: RootHex,
  observedJustifiedEpoch: Epoch,
  headUnrealizedRoot: RootHex | null,
  headUnrealizedEpoch: Epoch | null
): FastConfirmationSnapshot {
  return {
    currentSlot,
    currentEpoch,
    headRoot,
    confirmedRoot,
    confirmedEpoch,
    confirmedSlot,
    observedJustified: checkpoint(observedJustifiedEpoch, observedJustifiedRoot),
    headUnrealized:
      headUnrealizedRoot !== null && headUnrealizedEpoch !== null
        ? checkpoint(headUnrealizedEpoch, headUnrealizedRoot)
        : null,
    finalizedRoot,
  };
}

export function nullBlock(root: RootHex): ProtoBlock {
  return makeBlock(0, ZERO_ROOT, {blockRoot: root});
}

export function latestMessagesFor(
  validatorCount: number,
  voteRoot: RootHex,
  epoch: Epoch,
  count: number = validatorCount
): Map<ValidatorIndex, {root: RootHex; epoch: Epoch}> {
  const latestMessages = new Map<ValidatorIndex, {root: RootHex; epoch: Epoch}>();
  for (let i = 0; i < count; i++) {
    latestMessages.set(i, {root: voteRoot, epoch});
  }
  return latestMessages;
}
