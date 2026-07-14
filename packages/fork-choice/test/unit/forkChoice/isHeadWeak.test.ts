import {describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {ChainForkConfig, createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {ForkChoiceError, ForkChoiceErrorCode} from "../../../src/forkChoice/errors.js";
import {
  ExecutionStatus,
  ForkChoice,
  IForkChoiceStore,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "../../../src/index.js";
import {getBlockRoot, getStateRoot} from "../../utils/index.js";

/**
 * REORG_HEAD_WEIGHT_THRESHOLD is 20% of the per-slot committee weight. With 32 validators of 150
 * effective balance increments each and SLOTS_PER_EPOCH = 32 (mainnet preset), the threshold is:
 *   floor(floor((32 * 150) / 32) * 20 / 100) = floor(150 * 20 / 100) = 30
 */
const REORG_THRESHOLD = 30;
const VALIDATOR_COUNT = 32;
const BALANCE_INCREMENT = 150;

const gloasConfig = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
  GLOAS_FORK_EPOCH: 0,
});

const genesisSlot = 0;
const genesisEpoch = 0;
const parentSlot = genesisSlot + 1;
const headSlot = genesisSlot + 2;

/** The execution payload block hash of a block, keyed off its slot. Blocks form a payload chain. */
function getPayloadBlockHash(slot: Slot): RootHex {
  return `0xpayload${slot}`;
}

/**
 * isGloasBlock() keys off parentBlockHash being non-null, so `isGloas` decides whether the block
 * carries the three payload variants (PENDING/EMPTY/FULL) or just FULL.
 */
function toProtoBlock(slot: Slot, parentRoot: RootHex, isGloas: boolean): ProtoBlock {
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

    executionPayloadBlockHash: getPayloadBlockHash(slot),
    executionPayloadNumber: slot,
    executionPayloadGasLimit: 30_000_000,
    executionStatus: ExecutionStatus.Valid,
    dataAvailabilityStatus: DataAvailabilityStatus.Available,

    parentBlockHash: isGloas ? getPayloadBlockHash(slot - 1) : null,
    payloadStatus: PayloadStatus.FULL,
  };
}

/** A state whose only slot committee is every validator, so equivocators always count */
function mockState(): IBeaconStateView {
  const activeIndices = Uint32Array.from(Array.from({length: VALIDATOR_COUNT}, (_, i) => i));
  return {
    getBeaconCommitteeCountPerSlot: () => 1,
    getBeaconCommittee: () => activeIndices,
  } as unknown as IBeaconStateView;
}

function makeStore({
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
 * Build a genesis -> parent -> head chain, apply `headVotes` attester weight to the head block, and
 * optionally boost it. Returns a ForkChoice ready for isHeadWeak(), plus the head block root.
 */
function setup({
  isGloas,
  config,
  headVotes,
  proposerBoost = null,
  store = makeStore(),
}: {
  isGloas: boolean;
  config: ChainForkConfig;
  headVotes: number;
  proposerBoost?: {root: RootHex; score: number} | null;
  store?: IForkChoiceStore;
}): {forkChoice: ForkChoice; headRoot: RootHex} {
  const genesisRoot = getBlockRoot(genesisSlot);
  const protoArray = ProtoArray.initialize(toProtoBlock(genesisSlot, genesisRoot, false), genesisSlot);
  protoArray.onBlock(toProtoBlock(parentSlot, genesisRoot, isGloas), parentSlot, null);
  protoArray.onBlock(toProtoBlock(headSlot, getBlockRoot(parentSlot), isGloas), headSlot, null);

  // The ForkChoice constructor calls updateHead(), which re-runs applyScoreChanges with whatever boost
  // it holds (none). Build it first, then apply the scores, so the boost under test survives.
  const forkChoice = new ForkChoice(config, store, protoArray, VALIDATOR_COUNT, null);

  const headRoot = getBlockRoot(headSlot);
  const attestationDeltas = protoArray.nodes.map((node) =>
    // credit the votes to the head's canonical (boostable) variant only
    node.blockRoot === headRoot && node.payloadStatus === (isGloas ? PayloadStatus.PENDING : PayloadStatus.FULL)
      ? headVotes
      : 0
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

  return {forkChoice, headRoot};
}

/** isHeadWeak is private; it is only reachable from getProposerHead / shouldApplyProposerBoost */
function isHeadWeak(forkChoice: ForkChoice, blockRoot: RootHex): boolean {
  return (forkChoice as unknown as {isHeadWeak(blockRoot: RootHex): boolean}).isHeadWeak(blockRoot);
}

describe("Forkchoice / isHeadWeak", () => {
  describe("pre-gloas", () => {
    it("is weak when the boost-inclusive weight is below the threshold", () => {
      const {forkChoice, headRoot} = setup({isGloas: false, config: defaultConfig, headVotes: 10});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(true);
    });

    it("is not weak when the boost-inclusive weight reaches the threshold", () => {
      const {forkChoice, headRoot} = setup({isGloas: false, config: defaultConfig, headVotes: REORG_THRESHOLD});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(false);
    });

    it("counts proposer boost towards the weight, per phase0 get_weight", () => {
      // Attester votes alone are weak, but the boost carries the block over the threshold
      const {forkChoice, headRoot} = setup({
        isGloas: false,
        config: defaultConfig,
        headVotes: 10,
        proposerBoost: {root: getBlockRoot(headSlot), score: REORG_THRESHOLD},
      });
      expect(isHeadWeak(forkChoice, headRoot)).toBe(false);
    });

    it("ignores equivocating validators, which are gloas-only", () => {
      const store = makeStore({equivocatingIndices: new Set([0, 1, 2]), state: mockState()});
      const {forkChoice, headRoot} = setup({isGloas: false, config: defaultConfig, headVotes: 10, store});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(true);
    });
  });

  describe("gloas", () => {
    it("excludes proposer boost from the weight, per gloas get_attestation_score", () => {
      // Same numbers as the pre-gloas "counts proposer boost" case above, but gloas must ignore the
      // boost and still report the head as weak. This is the circularity gloas is_head_weak avoids:
      // gloas get_weight() gates the boost on should_apply_proposer_boost(), which calls this function.
      const {forkChoice, headRoot} = setup({
        isGloas: true,
        config: gloasConfig,
        headVotes: 10,
        proposerBoost: {root: getBlockRoot(headSlot), score: REORG_THRESHOLD},
      });
      expect(isHeadWeak(forkChoice, headRoot)).toBe(true);
    });

    it("is not weak when attester votes alone reach the threshold", () => {
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig, headVotes: REORG_THRESHOLD});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(false);
    });

    it("adds back the weight of equivocating validators in the block's committees", () => {
      // 10 attester votes is weak on its own, but 1 equivocating validator adds 150 back, clearing 120
      const store = makeStore({equivocatingIndices: new Set([0]), state: mockState()});
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig, headVotes: 10, store});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(false);
    });

    it("is weak when there are no equivocating validators to add back", () => {
      const store = makeStore({equivocatingIndices: new Set(), state: mockState()});
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig, headVotes: 10, store});
      expect(isHeadWeak(forkChoice, headRoot)).toBe(true);
    });

    it("throws when the state needed for the add-back is unavailable", () => {
      // isHeadWeak only runs on the head or the boosted block's parent, so the state is always cached
      const store = makeStore({equivocatingIndices: new Set([0]), state: null});
      const {forkChoice, headRoot} = setup({isGloas: true, config: gloasConfig, headVotes: 10, store});
      expect(() => isHeadWeak(forkChoice, headRoot)).toThrow(ForkChoiceError);
    });
  });

  it("throws for a block that is not in fork choice", () => {
    const {forkChoice} = setup({isGloas: false, config: defaultConfig, headVotes: 10});
    const unknownRoot = getBlockRoot(headSlot + 100);

    expect(() => isHeadWeak(forkChoice, unknownRoot)).toThrow(
      new ForkChoiceError({code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK, root: unknownRoot})
    );
  });
});
