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

type ProposerBoost = {root: RootHex; score: number} | null;

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

/** node weights keyed by blockRoot */
function weights(protoArray: ProtoArray): Record<RootHex, number> {
  return Object.fromEntries(protoArray.nodes.map((node) => [node.blockRoot, node.weight]));
}

function attestationScores(protoArray: ProtoArray): Record<RootHex, number> {
  return Object.fromEntries(protoArray.nodes.map((node) => [node.blockRoot, node.attestationScore]));
}

describe("ProtoArray attestationScore", () => {
  /**
   * The implementation before attestationScore was split out: a single delta channel carrying both
   * attester votes and proposer boost. Kept as an oracle: splitting the channels must not move `weight`.
   */
  function naiveApplyScoreChanges(
    nodes: {blockRoot: RootHex; parent?: number; weight: number}[],
    deltas: number[],
    proposerBoost: ProposerBoost,
    previousProposerBoost: ProposerBoost
  ): void {
    for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex--) {
      const node = nodes[nodeIndex];
      if (node.blockRoot === HEX_ZERO_HASH) continue;

      const currentBoost = proposerBoost && proposerBoost.root === node.blockRoot ? proposerBoost.score : 0;
      const previousBoost =
        previousProposerBoost && previousProposerBoost.root === node.blockRoot ? previousProposerBoost.score : 0;

      const nodeDelta = deltas[nodeIndex] + currentBoost - previousBoost;
      node.weight += nodeDelta;

      if (node.parent !== undefined) {
        deltas[node.parent] += nodeDelta;
      }
    }
  }

  it("weight matches the pre-split implementation over a sequence of attestations and boosts", () => {
    const protoArray = setupProtoArray();
    // Mirror of protoArray.nodes, driven by the naive oracle
    const oracleNodes = protoArray.nodes.map((node) => ({
      blockRoot: node.blockRoot,
      parent: node.parent,
      weight: 0,
    }));

    // Deterministic pseudo-random deltas, so a failure is reproducible
    let seed = 42;
    const nextDelta = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 21) - 10;
    };

    const boostable: ProposerBoost[] = [
      null,
      {root: "3A", score: 100},
      {root: "2A", score: 100},
      // boost moves to a sibling fork: the case previousBoost has to cancel on the old branch
      {root: "2B", score: 100},
      {root: "3A", score: 70},
      null,
    ];

    let previousProposerBoost: ProposerBoost = null;
    for (const proposerBoost of boostable) {
      const deltas = protoArray.nodes.map(() => nextDelta());

      // applyScoreChanges mutates the deltas array in place, so give each side its own copy
      applyScoreChanges(protoArray, {deltas: [...deltas], proposerBoost});
      naiveApplyScoreChanges(oracleNodes, [...deltas], proposerBoost, previousProposerBoost);
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

    expect(attestationScores(protoArray)).toEqual({[ANCHOR]: 10, "1A": 10, "2A": 10, "3A": 10, "2B": 0});
    expect(weights(protoArray)).toEqual({[ANCHOR]: 10, "1A": 10, "2A": 10, "3A": 10, "2B": 0});

    // Boost 3A. It is credited to 3A and to every ancestor, but attestationScore must not move.
    applyScoreChanges(protoArray, {
      deltas: protoArray.nodes.map(() => 0),
      proposerBoost: {root: "3A", score: 100},
    });

    expect(attestationScores(protoArray)).toEqualWithMessage(
      {[ANCHOR]: 10, "1A": 10, "2A": 10, "3A": 10, "2B": 0},
      "boost must not leak into attestationScore, on the boosted node or its ancestors"
    );
    expect(weights(protoArray)).toEqualWithMessage(
      {[ANCHOR]: 110, "1A": 110, "2A": 110, "3A": 110, "2B": 0},
      "boost is credited to the boosted node and every ancestor"
    );
  });

  it("does not credit boost to a node that is not an ancestor of the boosted node", () => {
    const protoArray = setupProtoArray();

    applyScoreChanges(protoArray, {
      deltas: protoArray.nodes.map(() => 0),
      proposerBoost: {root: "3A", score: 100},
    });

    // 2B forks off 1A, so it is not an ancestor of 3A
    expect(weights(protoArray)["2B"]).toBe(0);
    expect(attestationScores(protoArray)["2B"]).toBe(0);
  });

  it("weight returns to attestationScore once the boost is cleared", () => {
    const protoArray = setupProtoArray();

    const deltas = protoArray.nodes.map((node) => (node.blockRoot === "3A" ? 10 : 0));
    applyScoreChanges(protoArray, {deltas, proposerBoost: {root: "3A", score: 100}});
    expect(weights(protoArray)["3A"]).toBe(110);

    // onTick clears proposerBoostRoot at the start of a slot, so the next round applies a null boost
    applyScoreChanges(protoArray, {deltas: protoArray.nodes.map(() => 0), proposerBoost: null});

    for (const node of protoArray.nodes) {
      expect(node.weight).toBeWithMessage(
        node.attestationScore,
        `boost must be fully unwound from ${node.blockRoot}, leaving only attester votes`
      );
    }
    expect(weights(protoArray)).toEqual({[ANCHOR]: 10, "1A": 10, "2A": 10, "3A": 10, "2B": 0});
  });
});
