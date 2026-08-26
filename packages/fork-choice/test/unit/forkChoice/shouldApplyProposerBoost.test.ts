import {describe, expect, it} from "vitest";
import {IBeaconStateView} from "@lodestar/state-transition";
import {RootHex, Slot, ValidatorIndex} from "@lodestar/types";
import {ForkChoice, IForkChoiceStore, PayloadStatus, ProtoArray} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {
  BALANCE_INCREMENT,
  VALIDATOR_COUNT,
  genesisEpoch,
  genesisSlot,
  getPayloadBlockHash,
  gloasConfig,
  headSlot,
  makeStore,
  parentSlot,
  toProtoBlock,
} from "./proposerHeadTestUtils.js";

/** See isHeadWeak.test.ts: floor(floor((32 * 150) / 32) * 20 / 100) = 30 */
const REORG_THRESHOLD = 30;
/** PROPOSER_SCORE_BOOST is 40%, in gwei: floor(floor((32 * 150) / 32) * 40 / 100) increments = 60 */
const BOOST_SCORE = BigInt(60) * 1_000_000_000n;

const PARENT_PROPOSER = 7;
const SIBLING_ROOT = "0xsibling";

/** A state whose slot committees are empty, so equivocator balances are never added back */
function mockStateEmptyCommittee(): IBeaconStateView {
  return {
    getBeaconCommitteeCountPerSlot: () => 1,
    getBeaconCommittee: () => Uint32Array.from([]),
    effectiveBalanceIncrements: new Uint16Array(Array(VALIDATOR_COUNT).fill(BALANCE_INCREMENT)),
  } as unknown as IBeaconStateView;
}

function setBoostRoot(forkChoice: ForkChoice, root: RootHex): void {
  (forkChoice as unknown as {proposerBoostRoot: RootHex | null}).proposerBoostRoot = root;
}

/** Queue a not-yet-applied vote, as onAttestation would, so updateHead() computes its delta */
function setPendingVote(forkChoice: ForkChoice, validatorIndex: ValidatorIndex, nodeIndex: number): void {
  (forkChoice as unknown as {voteNextIndices: number[]}).voteNextIndices[validatorIndex] = nodeIndex;
}

/** The boost currently held by a block = the gap between its total weight and its attestation score */
function appliedBoost(protoArray: ProtoArray, root: RootHex): bigint {
  const node = protoArray.getNode(root, PayloadStatus.PENDING);
  if (node === undefined) throw Error(`missing PENDING node for ${root}`);
  return node.weight - node.attestationScore;
}

/**
 * Build a gloas chain genesis -> parent -> child where the child holds proposer boost, plus an
 * optional sibling of the parent (same slot) to act as the proposer equivocation.
 * Votes passed here are applied to scores before the measured updateHead(), emulating state from a
 * previous head update; use setPendingVote for votes the measured updateHead() itself must apply.
 */
function setup({
  sibling = null,
  parentVotes = 0,
  store = makeStore(),
  childSlot = headSlot,
}: {
  sibling?: {ptcTimeliness: boolean; proposerIndex?: ValidatorIndex} | null;
  parentVotes?: number;
  store?: IForkChoiceStore;
  childSlot?: Slot;
} = {}): {forkChoice: ForkChoice; protoArray: ProtoArray; parentRoot: RootHex; childRoot: RootHex} {
  const genesisRoot = getBlockRoot(genesisSlot);
  const parentRoot = getBlockRoot(parentSlot);
  const childRoot = getBlockRoot(childSlot);

  const protoArray = ProtoArray.initialize(toProtoBlock(genesisSlot, genesisRoot, false), genesisSlot);
  protoArray.onBlock(toProtoBlock(parentSlot, genesisRoot, true, {proposerIndex: PARENT_PROPOSER}), parentSlot, null);
  if (sibling) {
    protoArray.onBlock(
      toProtoBlock(parentSlot, genesisRoot, true, {
        blockRoot: SIBLING_ROOT,
        proposerIndex: sibling.proposerIndex ?? PARENT_PROPOSER,
        ptcTimeliness: sibling.ptcTimeliness,
        executionPayloadBlockHash: "0xpayload_sibling",
      }),
      parentSlot,
      null
    );
  }
  protoArray.onBlock(
    toProtoBlock(childSlot, parentRoot, true, {parentBlockHash: getPayloadBlockHash(parentSlot)}),
    childSlot,
    null
  );

  const forkChoice = new ForkChoice(gloasConfig, store, protoArray, VALIDATOR_COUNT, null, {proposerBoost: true});

  if (parentVotes > 0) {
    protoArray.applyScoreChanges({
      attestationDeltas: protoArray.nodes.map((node) =>
        node.blockRoot === parentRoot && node.payloadStatus === PayloadStatus.PENDING ? parentVotes : 0
      ),
      proposerBoost: null,
      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,
      currentSlot: store.currentSlot,
    });
  }

  setBoostRoot(forkChoice, childRoot);

  return {forkChoice, protoArray, parentRoot, childRoot};
}

function pendingNodeIndex(protoArray: ProtoArray, root: RootHex): number {
  const index = protoArray.nodes.findIndex(
    (node) => node.blockRoot === root && node.payloadStatus === PayloadStatus.PENDING
  );
  if (index < 0) throw Error(`missing PENDING node for ${root}`);
  return index;
}

describe("Forkchoice / shouldApplyProposerBoost", () => {
  it("withholds boost when the parent is weak, adjacent, and its proposer equivocated PTC-timely", () => {
    const {forkChoice, protoArray, childRoot} = setup({sibling: {ptcTimeliness: true}});

    forkChoice.updateHead();

    expect(appliedBoost(protoArray, childRoot)).toBe(0n);
  });

  it("applies boost when the equivocating sibling is not PTC-timely", () => {
    const {forkChoice, protoArray, childRoot} = setup({sibling: {ptcTimeliness: false}});

    forkChoice.updateHead();

    expect(appliedBoost(protoArray, childRoot)).toBe(BOOST_SCORE);
  });

  it("applies boost when the sibling was proposed by a different proposer", () => {
    const {forkChoice, protoArray, childRoot} = setup({
      sibling: {ptcTimeliness: true, proposerIndex: PARENT_PROPOSER + 1},
    });

    forkChoice.updateHead();

    expect(appliedBoost(protoArray, childRoot)).toBe(BOOST_SCORE);
  });

  it("applies boost when the parent is not weak", () => {
    const {forkChoice, protoArray, childRoot} = setup({
      sibling: {ptcTimeliness: true},
      parentVotes: REORG_THRESHOLD,
    });

    forkChoice.updateHead();

    expect(appliedBoost(protoArray, childRoot)).toBe(BOOST_SCORE);
  });

  it("applies boost when the parent is not from the previous slot", () => {
    const {forkChoice, protoArray, childRoot} = setup({sibling: {ptcTimeliness: true}, childSlot: headSlot + 1});

    forkChoice.updateHead();

    expect(appliedBoost(protoArray, childRoot)).toBe(BOOST_SCORE);
  });

  it("applies this round's attestation deltas before deciding the boost", () => {
    // The parent looks weak on the scores cached from the previous head update, but the vote
    // pending in this very updateHead() carries it over the threshold. The boost decision must see
    // the post-delta score and apply the boost, spec get_attestation_score being vote-current.
    const {forkChoice, protoArray, parentRoot, childRoot} = setup({sibling: {ptcTimeliness: true}});
    setPendingVote(forkChoice, 0, pendingNodeIndex(protoArray, parentRoot));

    forkChoice.updateHead();

    expect(appliedBoost(protoArray, childRoot)).toBe(BOOST_SCORE);
  });

  it("removes a newly detected equivocator's vote before judging the parent weak", () => {
    // Validator 0's vote is the parent's entire attestation score. Marking it equivocating and
    // updating the head once must first discount the vote (parent score 150 -> 0), and with the
    // equivocator outside the parent slot's committees nothing is added back: the parent is weak
    // and the boost is withheld. Reading the stale pre-delta score would double-keep the vote and
    // wrongly apply the boost.
    const equivocatingIndices = new Set<ValidatorIndex>();
    const store = makeStore({equivocatingIndices, state: mockStateEmptyCommittee()});
    const {forkChoice, protoArray, parentRoot, childRoot} = setup({sibling: {ptcTimeliness: true}, store});

    // First head update applies the vote, as a previous slot would have
    setPendingVote(forkChoice, 0, pendingNodeIndex(protoArray, parentRoot));
    forkChoice.updateHead();
    expect(appliedBoost(protoArray, childRoot)).toBe(BOOST_SCORE);

    // Now the validator is discovered equivocating; the measured single updateHead() must both
    // discount the vote and withhold the boost
    equivocatingIndices.add(0);
    forkChoice.updateHead();

    expect(appliedBoost(protoArray, childRoot)).toBe(0n);
  });
});
