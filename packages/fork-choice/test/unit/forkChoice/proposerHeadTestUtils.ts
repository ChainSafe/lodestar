import {fromHexString} from "@chainsafe/ssz";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {
  ExecutionStatus,
  ForkChoice,
  IForkChoiceStore,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "../../../src/index.js";
import {getBlockRoot, getStateRoot} from "../../utils/index.js";

export const VALIDATOR_COUNT = 32;
export const BALANCE_INCREMENT = 150;

export const gloasConfig = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
  GLOAS_FORK_EPOCH: 0,
});

export const genesisSlot = 0;
export const genesisEpoch = 0;
export const parentSlot = genesisSlot + 1;
export const headSlot = genesisSlot + 2;

/** The execution payload block hash of a block, keyed off its slot. Blocks form a payload chain. */
export function getPayloadBlockHash(slot: Slot): RootHex {
  return `0xpayload${slot}`;
}

/**
 * isGloasBlock() keys off parentBlockHash being non-null, so `isGloas` decides whether the block
 * carries the three payload variants (PENDING/EMPTY/FULL) or just FULL.
 */
export function toProtoBlock(
  slot: Slot,
  parentRoot: RootHex,
  isGloas: boolean,
  overrides: Partial<ProtoBlock> = {}
): ProtoBlock {
  return {
    slot,
    blockRoot: getBlockRoot(slot),
    parentRoot,
    stateRoot: getStateRoot(slot),
    targetRoot: getBlockRoot(slot),

    justifiedEpoch: genesisEpoch,
    justifiedRoot: getBlockRoot(genesisSlot),
    finalizedEpoch: genesisEpoch,
    finalizedRoot: getBlockRoot(genesisSlot),
    unrealizedJustifiedEpoch: genesisEpoch,
    unrealizedJustifiedRoot: getBlockRoot(genesisSlot),
    unrealizedFinalizedEpoch: genesisEpoch,
    unrealizedFinalizedRoot: getBlockRoot(genesisSlot),

    timeliness: false,
    importedTimely: false,
    ptcTimeliness: false,
    proposerIndex: 0,

    executionPayloadBlockHash: getPayloadBlockHash(slot),
    executionPayloadNumber: slot,
    executionPayloadGasLimit: 30_000_000,
    executionStatus: ExecutionStatus.Valid,
    dataAvailabilityStatus: DataAvailabilityStatus.Available,

    parentBlockHash: isGloas ? getPayloadBlockHash(slot - 1) : null,
    payloadStatus: PayloadStatus.FULL,

    ...overrides,
    // ProtoBlock is a union over the execution fields; spreading Partial<ProtoBlock> loses the
    // narrowing even though every base object here is the post-merge shape
  } as ProtoBlock;
}

/** A state whose only slot committee is every validator, so equivocators always count */
export function mockState(): IBeaconStateView {
  const activeIndices = Uint32Array.from(Array.from({length: VALIDATOR_COUNT}, (_, i) => i));
  return {
    getBeaconCommitteeCountPerSlot: () => 1,
    getBeaconCommittee: () => activeIndices,
    // is_head_weak reads the equivocators' balances off the head state, not fcStore.justified.balances,
    // which is zeroed for them
    effectiveBalanceIncrements: new Uint16Array(Array(VALIDATOR_COUNT).fill(BALANCE_INCREMENT)),
  } as unknown as IBeaconStateView;
}

export function makeStore({
  equivocatingIndices = new Set<ValidatorIndex>(),
  state = null,
}: {
  equivocatingIndices?: Set<ValidatorIndex>;
  state?: IBeaconStateView | null;
} = {}): IForkChoiceStore {
  const genesisRoot = getBlockRoot(genesisSlot);
  const balances = new Uint16Array(Array(VALIDATOR_COUNT).fill(BALANCE_INCREMENT));
  const checkpoint = {epoch: genesisEpoch, root: fromHexString(genesisRoot), rootHex: genesisRoot};

  return {
    currentSlot: headSlot + 1,
    justified: {checkpoint, balances, totalBalance: VALIDATOR_COUNT * BALANCE_INCREMENT},
    unrealizedJustified: {checkpoint, balances},
    finalizedCheckpoint: checkpoint,
    unrealizedFinalizedCheckpoint: checkpoint,
    justifiedBalancesGetter: () => balances,
    equivocatingIndices,
    confirmedRoot: genesisRoot,
    previousEpochObservedJustifiedCheckpoint: checkpoint,
    currentEpochObservedJustifiedCheckpoint: checkpoint,
    previousEpochGreatestUnrealizedCheckpoint: checkpoint,
    previousEpochObservedJustifiedBalances: balances,
    currentEpochObservedJustifiedBalances: balances,
    previousEpochGreatestUnrealizedBalances: balances,
    previousSlotHead: genesisRoot,
    currentSlotHead: genesisRoot,
    stateGetter: () => state,
  };
}

/**
 * Build a genesis -> parent -> head chain, apply attester weight to the parent and/or head block, and
 * optionally boost. Returns a ForkChoice ready for isHeadWeak() / isParentStrong(), plus both roots.
 *
 * Note attestation and boost deltas both back-propagate to ancestors, so the parent's weight includes
 * `headVotes` and any boost applied to the head.
 */
export function setup({
  isGloas,
  config,
  headVotes = 0,
  parentVotes = 0,
  proposerBoost = null,
  store = makeStore(),
}: {
  isGloas: boolean;
  config: ChainForkConfig;
  headVotes?: number;
  parentVotes?: number;
  proposerBoost?: {root: RootHex; score: bigint} | null;
  store?: IForkChoiceStore;
}): {forkChoice: ForkChoice; headRoot: RootHex; parentRoot: RootHex} {
  const genesisRoot = getBlockRoot(genesisSlot);
  const protoArray = ProtoArray.initialize(toProtoBlock(genesisSlot, genesisRoot, false), genesisSlot);
  protoArray.onBlock(toProtoBlock(parentSlot, genesisRoot, isGloas), parentSlot, null);
  protoArray.onBlock(toProtoBlock(headSlot, getBlockRoot(parentSlot), isGloas), headSlot, null);

  // The ForkChoice constructor calls updateHead(), which re-runs applyScoreChanges with whatever boost
  // it holds (none). Build it first, then apply the scores, so the boost under test survives.
  const forkChoice = new ForkChoice(config, store, protoArray, VALIDATOR_COUNT, null);

  const headRoot = getBlockRoot(headSlot);
  const parentRoot = getBlockRoot(parentSlot);
  const votesByRoot = new Map<RootHex, number>([
    [headRoot, headVotes],
    [parentRoot, parentVotes],
  ]);
  const canonicalVariant = isGloas ? PayloadStatus.PENDING : PayloadStatus.FULL;
  const attestationDeltas = protoArray.nodes.map((node) =>
    // credit the votes to each block's canonical (boostable) variant only
    node.payloadStatus === canonicalVariant ? (votesByRoot.get(node.blockRoot) ?? 0) : 0
  );

  protoArray.applyScoreChanges({
    attestationDeltas,
    proposerBoost,
    justifiedEpoch: genesisEpoch,
    justifiedRoot: genesisRoot,
    finalizedEpoch: genesisEpoch,
    finalizedRoot: genesisRoot,
    currentSlot: headSlot + 1,
  });

  return {forkChoice, headRoot, parentRoot};
}
