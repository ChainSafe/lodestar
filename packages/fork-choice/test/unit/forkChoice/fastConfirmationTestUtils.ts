import {fromHexString} from "@chainsafe/ssz";
import {CachedBeaconStateAllForks, DataAvailabilityStatus} from "@lodestar/state-transition";
import {Epoch, RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {
  FastConfirmationContext,
  FastConfirmationSnapshot,
  IFastConfirmationStore,
} from "../../../src/forkChoice/fastConfirmation/types.js";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "../../../src/index.js";

export const ZERO_ROOT = rootFromNumber(0);

export function rootFromNumber(n: number): RootHex {
  return `0x${n.toString(16).padStart(64, "0")}`;
}

export function checkpoint(epoch: Epoch, rootHex: RootHex): {epoch: Epoch; root: Uint8Array; rootHex: RootHex} {
  return {epoch, root: fromHexString(rootHex), rootHex};
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
    builderIndex: null,
    blockHashFromBid: null,
  };
}

export function makeState(
  validatorCount: number,
  balancePerValidator: number,
  committeeSlots: Slot[],
  slashedIndices: ValidatorIndex[] = []
): CachedBeaconStateAllForks {
  const balances = new Uint16Array(Array.from({length: validatorCount}, () => balancePerValidator));
  const activeIndices = Array.from({length: validatorCount}, (_, i) => i as ValidatorIndex);
  const slashed = new Set<ValidatorIndex>(slashedIndices);
  const committees = new Map<Slot, ValidatorIndex[]>(committeeSlots.map((slot) => [slot, activeIndices]));

  return {
    epochCtx: {
      totalActiveBalanceIncrements: validatorCount * balancePerValidator,
      effectiveBalanceIncrements: balances,
      currentShuffling: {activeIndices},
      getCommitteeCountPerSlot: () => 1,
      getBeaconCommittee: (slot: Slot) => committees.get(slot) ?? activeIndices,
    },
    validators: {
      get: (index: ValidatorIndex) => ({slashed: slashed.has(index)}),
    },
  } as unknown as CachedBeaconStateAllForks;
}

export function makeStore(
  confirmedRoot: RootHex,
  previousObservedRoot: RootHex,
  currentObservedRoot: RootHex,
  previousObservedEpoch: Epoch,
  currentObservedEpoch: Epoch,
  previousSlotHead: RootHex,
  currentSlotHead: RootHex,
  state: CachedBeaconStateAllForks
): IFastConfirmationStore {
  const balances = state.epochCtx.effectiveBalanceIncrements;
  return {
    confirmedRoot,
    previousEpochObservedJustifiedCheckpoint: checkpoint(previousObservedEpoch, previousObservedRoot),
    currentEpochObservedJustifiedCheckpoint: checkpoint(currentObservedEpoch, currentObservedRoot),
    previousEpochObservedJustifiedBalances: balances,
    currentEpochObservedJustifiedBalances: balances,
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
  state: CachedBeaconStateAllForks,
  equivocatingIndices: ValidatorIndex[] = []
): FastConfirmationContext {
  const blocksByRoot = new Map(blocks.map((block) => [block.blockRoot, block]));
  const equivocating = new Set(equivocatingIndices);

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
      balances: state.epochCtx.effectiveBalanceIncrements,
    }),
    getFinalizedCheckpoint: () => checkpoint(0, ZERO_ROOT),
    getEquivocatingIndices: () => equivocating,
    getTrackedVotesCount: () => latestMessages.size,
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
