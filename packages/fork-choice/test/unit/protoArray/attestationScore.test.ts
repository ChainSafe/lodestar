import {describe, expect, it} from "vitest";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {RootHex} from "@lodestar/types";
import {ExecutionStatus, PayloadStatus, ProtoArray, ProtoBlock} from "../../../src/index.js";
import {HEX_ZERO_HASH} from "../../../src/protoArray/interface.js";

/**
 * Chain layout, "2B" forks off "1A" so it is never an ancestor of "3A":
 *
 *   0 - 1A - 2A - 3A
 *         \
 *          2B
 */
const ANCHOR = "0";
const INC_GWEI = 1_000_000_000n;
const gwei = (increments: number, remainderGwei = 0): bigint => BigInt(increments) * INC_GWEI + BigInt(remainderGwei);
const CHAIN: {slot: number; root: RootHex; parent: RootHex}[] = [
  {slot: 1, root: "1A", parent: ANCHOR},
  {slot: 2, root: "2A", parent: "1A"},
  {slot: 3, root: "3A", parent: "2A"},
  {slot: 2, root: "2B", parent: "1A"},
];

function toProtoBlock(slot: number, blockRoot: RootHex, parentRoot: RootHex): ProtoBlock {
  return {
    slot,
    blockRoot,
    parentRoot,
    stateRoot: "-",
    targetRoot: "-",

    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",
    unrealizedJustifiedEpoch: 0,
    unrealizedJustifiedRoot: "-",
    unrealizedFinalizedEpoch: 0,
    unrealizedFinalizedRoot: "-",

    timeliness: false,
    importedTimely: false,
    ptcTimeliness: false,
    proposerIndex: 0,

    executionPayloadBlockHash: null,
    executionStatus: ExecutionStatus.PreMerge,
    dataAvailabilityStatus: DataAvailabilityStatus.PreData,

    parentBlockHash: null,
    payloadStatus: PayloadStatus.FULL,
  };
}

function setupProtoArray(): ProtoArray {
  const protoArray = ProtoArray.initialize(toProtoBlock(0, ANCHOR, "-"), 0);
  for (const {slot, root, parent} of CHAIN) {
    protoArray.onBlock(toProtoBlock(slot, root, parent), slot, null);
  }
  return protoArray;
}

type ProposerBoost = {root: RootHex; score: bigint} | null;

/** Mirror of a ProtoNode, driven by the naive oracle */
type OracleNode = {blockRoot: RootHex; parent?: number; weight: bigint; invalid?: boolean};

/**
 * applyScoreChanges() reads executionStatus straight off the node, so flip it in place. Driving this
 * through validateLatestHash() would exercise the LVH plumbing instead, which executionStatusUpdates
 * .test.ts already covers.
 */
function markInvalid(protoArray: ProtoArray, oracleNodes: OracleNode[], blockRoot: RootHex): void {
  for (const node of protoArray.nodes) {
    if (node.blockRoot === blockRoot) {
      (node as {executionStatus: ExecutionStatus}).executionStatus = ExecutionStatus.Invalid;
    }
  }
  for (const node of oracleNodes) {
    if (node.blockRoot === blockRoot) {
      node.invalid = true;
    }
  }
}

/** A round of score changes: the deltas fed to applyScoreChanges plus the boost in effect */
type Round = {deltas: number[]; proposerBoost: ProposerBoost};

function applyScoreChanges(protoArray: ProtoArray, {deltas, proposerBoost}: Round): void {
  protoArray.applyScoreChanges({
    attestationDeltas: deltas,
    proposerBoost,
    justifiedEpoch: 0,
    justifiedRoot: "-",
    finalizedEpoch: 0,
    finalizedRoot: "-",
    currentSlot: 3,
  });
}

/** Node weights in Gwei, keyed by blockRoot. */
function weights(protoArray: ProtoArray): Record<RootHex, bigint> {
  return Object.fromEntries(protoArray.nodes.map((node) => [node.blockRoot, node.weight]));
}

function attestationScores(protoArray: ProtoArray): Record<RootHex, bigint> {
  return Object.fromEntries(protoArray.nodes.map((node) => [node.blockRoot, node.attestationScore]));
}

describe("ProtoArray attestationScore", () => {
  /**
   * The implementation before attestationScore was split out: a single delta channel carrying both
   * attester votes and proposer boost. Kept as an oracle: splitting the channels must not move `weight`.
   */
  function naiveApplyScoreChanges(
    nodes: OracleNode[],
    deltas: bigint[],
    proposerBoost: ProposerBoost,
    previousProposerBoost: ProposerBoost
  ): void {
    for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
      const node = nodes[nodeIndex];
      if (node.blockRoot === HEX_ZERO_HASH) continue;

      const currentBoost = proposerBoost && proposerBoost.root === node.blockRoot ? proposerBoost.score : 0n;
      const previousBoost =
        previousProposerBoost && previousProposerBoost.root === node.blockRoot ? previousProposerBoost.score : 0n;

      // an invalid node drops its whole weight, boost included, and stays at 0 from then on
      const nodeDelta = node.invalid ? -node.weight : deltas[nodeIndex] + currentBoost - previousBoost;
      node.weight += nodeDelta;

      if (node.parent !== undefined) {
        deltas[node.parent] += nodeDelta;
      }
    }
  }

  it("weight matches the pre-split implementation over a sequence of attestations and boosts", () => {
    const protoArray = setupProtoArray();
    // Mirror of protoArray.nodes, driven by the naive oracle
    const oracleNodes: OracleNode[] = protoArray.nodes.map((node) => ({
      blockRoot: node.blockRoot,
      parent: node.parent,
      weight: 0n,
    }));

    // Deterministic pseudo-random deltas, so a failure is reproducible
    let seed = 42;
    const nextDelta = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 21) - 10;
    };

    const boostable: ProposerBoost[] = [
      null,
      {root: "3A", score: gwei(100)},
      {root: "2A", score: gwei(100)},
      // boost moves to a sibling fork: the case previousBoost has to cancel on the old branch
      {root: "2B", score: gwei(100)},
      {root: "3A", score: gwei(70)},
      null,
    ];

    // 3A is invalidated while it still carries a boost, so the round it goes invalid must drop both
    // its attester votes and its boost, and every later round must leave it at 0
    const invalidateBeforeRound: Record<number, RootHex> = {4: "3A"};

    let previousProposerBoost: ProposerBoost = null;
    for (const [round, proposerBoost] of boostable.entries()) {
      const toInvalidate = invalidateBeforeRound[round];
      if (toInvalidate !== undefined) {
        markInvalid(protoArray, oracleNodes, toInvalidate);
      }

      const deltas = protoArray.nodes.map(() => nextDelta());

      // applyScoreChanges mutates the deltas array in place, so give each side its own copy
      applyScoreChanges(protoArray, {deltas: [...deltas], proposerBoost});
      naiveApplyScoreChanges(
        oracleNodes,
        deltas.map((delta) => BigInt(delta) * INC_GWEI),
        proposerBoost,
        previousProposerBoost
      );
      previousProposerBoost = proposerBoost;

      for (const oracleNode of oracleNodes) {
        expect(weights(protoArray)[oracleNode.blockRoot]).toBeWithMessage(
          oracleNode.weight,
          `weight of ${oracleNode.blockRoot} must match the pre-split implementation`
        );
      }
    }
  });

  it("excludes proposer boost from attestationScore on the boosted node and all its ancestors", () => {
    const protoArray = setupProtoArray();

    // One attester vote on 3A, which back-propagates to its ancestors 2A, 1A and the anchor
    const deltas = protoArray.nodes.map((node) => (node.blockRoot === "3A" ? 10 : 0));
    applyScoreChanges(protoArray, {deltas, proposerBoost: null});

    expect(attestationScores(protoArray)).toEqual({
      [ANCHOR]: gwei(10),
      "1A": gwei(10),
      "2A": gwei(10),
      "3A": gwei(10),
      "2B": 0n,
    });
    expect(weights(protoArray)).toEqual({
      [ANCHOR]: gwei(10),
      "1A": gwei(10),
      "2A": gwei(10),
      "3A": gwei(10),
      "2B": 0n,
    });

    // Boost 3A. It is credited to 3A and to every ancestor, but attestationScore must not move.
    applyScoreChanges(protoArray, {
      deltas: protoArray.nodes.map(() => 0),
      proposerBoost: {root: "3A", score: gwei(100)},
    });

    expect(attestationScores(protoArray)).toEqualWithMessage(
      {[ANCHOR]: gwei(10), "1A": gwei(10), "2A": gwei(10), "3A": gwei(10), "2B": 0n},
      "boost must not leak into attestationScore, on the boosted node or its ancestors"
    );
    expect(weights(protoArray)).toEqualWithMessage(
      {[ANCHOR]: gwei(110), "1A": gwei(110), "2A": gwei(110), "3A": gwei(110), "2B": 0n},
      "boost is credited to the boosted node and every ancestor"
    );
  });

  it("does not credit boost to a node that is not an ancestor of the boosted node", () => {
    const protoArray = setupProtoArray();

    applyScoreChanges(protoArray, {
      deltas: protoArray.nodes.map(() => 0),
      proposerBoost: {root: "3A", score: gwei(100)},
    });

    // 2B forks off 1A, so it is not an ancestor of 3A
    expect(weights(protoArray)["2B"]).toBe(0n);
    expect(attestationScores(protoArray)["2B"]).toBe(0n);
  });

  it("preserves an exact boost through score and root changes", () => {
    const protoArray = setupProtoArray();
    const initialScore = gwei(100, 250_000_000);
    const updatedScore = gwei(101, 750_000_000);

    applyScoreChanges(protoArray, {
      deltas: protoArray.nodes.map(() => 0),
      proposerBoost: {root: "3A", score: initialScore},
    });
    applyScoreChanges(protoArray, {
      deltas: protoArray.nodes.map(() => 0),
      proposerBoost: {root: "3A", score: updatedScore},
    });
    expect(weights(protoArray)["3A"]).toBe(updatedScore);

    applyScoreChanges(protoArray, {
      deltas: protoArray.nodes.map(() => 0),
      proposerBoost: {root: "2B", score: updatedScore},
    });

    expect(weights(protoArray)).toEqual({
      [ANCHOR]: updatedScore,
      "1A": updatedScore,
      "2A": 0n,
      "3A": 0n,
      "2B": updatedScore,
    });

    applyScoreChanges(protoArray, {deltas: protoArray.nodes.map(() => 0), proposerBoost: null});
    for (const node of protoArray.nodes) {
      expect(node.weight).toBeWithMessage(0n, `boost must be removed from ${node.blockRoot}`);
    }
  });

  it("prefers a branch with one additional Gwei before applying the root tiebreaker", () => {
    const protoArray = setupProtoArray();
    const deltas = protoArray.nodes.map((node) => (node.blockRoot === "3A" || node.blockRoot === "2B" ? 10 : 0));

    applyScoreChanges(protoArray, {
      deltas,
      proposerBoost: {root: "2B", score: 1n},
    });

    expect(protoArray.findHead(ANCHOR, 3).blockRoot).toBe("2B");
  });

  it("zeroes both channels of an invalid node and unwinds both from its ancestors", () => {
    const protoArray = setupProtoArray();

    // 10 votes on 3A and 5 on 2B, plus a boost on 3A
    const deltas = protoArray.nodes.map((node) => (node.blockRoot === "3A" ? 10 : node.blockRoot === "2B" ? 5 : 0));
    applyScoreChanges(protoArray, {
      deltas,
      proposerBoost: {root: "3A", score: gwei(100, 250_000_000)},
    });

    expect(attestationScores(protoArray)).toEqual({
      [ANCHOR]: gwei(15),
      "1A": gwei(15),
      "2A": gwei(10),
      "3A": gwei(10),
      "2B": gwei(5),
    });
    expect(weights(protoArray)).toEqual({
      [ANCHOR]: gwei(115, 250_000_000),
      "1A": gwei(115, 250_000_000),
      "2A": gwei(110, 250_000_000),
      "3A": gwei(110, 250_000_000),
      "2B": gwei(5),
    });

    // 3A goes invalid while still boosted. The invalid branch derives the boost to remove as
    // `weight - attestationScore`, so both channels have to unwind on 3A and on 2A/1A/anchor.
    markInvalid(protoArray, [], "3A");
    applyScoreChanges(protoArray, {
      deltas: protoArray.nodes.map(() => 0),
      proposerBoost: {root: "3A", score: gwei(100, 250_000_000)},
    });

    expect(attestationScores(protoArray)).toEqualWithMessage(
      {[ANCHOR]: gwei(5), "1A": gwei(5), "2A": 0n, "3A": 0n, "2B": gwei(5)},
      "the invalid node's attester votes must be removed from it and from every ancestor"
    );
    expect(weights(protoArray)).toEqualWithMessage(
      {[ANCHOR]: gwei(5), "1A": gwei(5), "2A": 0n, "3A": 0n, "2B": gwei(5)},
      "the invalid node's boost must be removed alongside its votes, leaving only 2B's votes"
    );
  });

  it("keeps an invalid node at zero on later rounds without double-unwinding its boost", () => {
    const protoArray = setupProtoArray();

    const deltas = protoArray.nodes.map((node) => (node.blockRoot === "3A" ? 10 : node.blockRoot === "2B" ? 5 : 0));
    applyScoreChanges(protoArray, {
      deltas,
      proposerBoost: {root: "3A", score: gwei(100, 250_000_000)},
    });

    markInvalid(protoArray, [], "3A");
    applyScoreChanges(protoArray, {
      deltas: protoArray.nodes.map(() => 0),
      proposerBoost: {root: "3A", score: gwei(100, 250_000_000)},
    });

    // The boost is cleared on the next tick. 3A is still invalid, so its deltas must compute to 0
    // rather than removing the already-removed boost a second time.
    applyScoreChanges(protoArray, {deltas: protoArray.nodes.map(() => 0), proposerBoost: null});

    expect(attestationScores(protoArray)).toEqual({
      [ANCHOR]: gwei(5),
      "1A": gwei(5),
      "2A": 0n,
      "3A": 0n,
      "2B": gwei(5),
    });
    expect(weights(protoArray)).toEqualWithMessage(
      {[ANCHOR]: gwei(5), "1A": gwei(5), "2A": 0n, "3A": 0n, "2B": gwei(5)},
      "clearing the boost must not unwind it a second time through the invalid node"
    );
  });

  it("weight returns to attestationScore once the boost is cleared", () => {
    const protoArray = setupProtoArray();

    const deltas = protoArray.nodes.map((node) => (node.blockRoot === "3A" ? 10 : 0));
    applyScoreChanges(protoArray, {deltas, proposerBoost: {root: "3A", score: gwei(100)}});
    expect(weights(protoArray)["3A"]).toBe(gwei(110));

    // onTick clears proposerBoostRoot at the start of a slot, so the next round applies a null boost
    applyScoreChanges(protoArray, {deltas: protoArray.nodes.map(() => 0), proposerBoost: null});

    for (const node of protoArray.nodes) {
      expect(node.weight).toBeWithMessage(
        node.attestationScore,
        `boost must be fully unwound from ${node.blockRoot}, leaving only attester votes`
      );
    }
    expect(weights(protoArray)).toEqual({
      [ANCHOR]: gwei(10),
      "1A": gwei(10),
      "2A": gwei(10),
      "3A": gwei(10),
      "2B": 0n,
    });
  });
});
