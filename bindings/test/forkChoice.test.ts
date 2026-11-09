import {mainnetChainConfig, minimalChainConfig} from "@lodestar/config/configs";
import {ACTIVE_PRESET, PresetName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {describe, expect, it} from "vitest";
import {
  type BlockSummary,
  ExecutionStatus,
  ForkChoice,
  NO_BLOCK,
  NO_NODE,
  PayloadStatus,
  type StateProvider,
} from "../src/fork-choice.js";
import bindings from "../src/index.js";

const chainConfig = ACTIVE_PRESET === PresetName.minimal ? minimalChainConfig : mainnetChainConfig;
const VALIDATOR_COUNT = 8;
const GWEI_PER_VALIDATOR = 32_000_000_000n;

function root(tag: number): Uint8Array {
  const out = new Uint8Array(32);
  out[0] = tag;
  return out;
}

const ANCHOR = root(1);
const anchorCheckpoint = {epoch: 0, root: ANCHOR};

function summary(tag: number, parent: Uint8Array, slot: number, extra?: Partial<BlockSummary>): BlockSummary {
  return {
    executionStatus: ExecutionStatus.PreMerge,
    finalizedCheckpoint: anchorCheckpoint,
    justifiedCheckpoint: anchorCheckpoint,
    parentRoot: parent,
    proposerIndex: 0,
    root: root(tag),
    slot,
    stateRoot: root(0xf0 + tag),
    unrealizedFinalizedCheckpoint: anchorCheckpoint,
    unrealizedJustifiedCheckpoint: anchorCheckpoint,
    ...extra,
  };
}

function createForkChoice(provider?: Partial<StateProvider>): ForkChoice {
  return new ForkChoice(new bindings.BeaconConfig(chainConfig, new Uint8Array(32)), 0, summary(1, root(0), 0), {
    justifiedBalances: () => new Uint16Array(VALIDATOR_COUNT).fill(32),
    slotCommitteeMembers: () => new Uint32Array(0),
    ...provider,
  });
}

function pendingNode(blockIndex: number): number {
  return blockIndex * 3 + PayloadStatus.Pending;
}

describe("ForkChoice", () => {
  it("starts at the anchor", () => {
    const forkChoice = createForkChoice();
    expect(forkChoice.blockCount).toBe(1);
    expect(forkChoice.currentSlot).toBe(0);
    expect(forkChoice.getHead()).toBe(pendingNode(0));
    expect(forkChoice.blockIndex(ANCHOR)).toBe(0);
    expect(forkChoice.blockIndex(root(9))).toBeUndefined();
    expect(forkChoice.parentNode(0)).toBeUndefined();
    expect(forkChoice.justifiedTotalBalance).toBe(BigInt(VALIDATOR_COUNT) * GWEI_PER_VALIDATOR);
    const {justified, finalized} = forkChoice.checkpoints();
    expect(justified).toEqual(anchorCheckpoint);
    expect(finalized).toEqual(anchorCheckpoint);
  });

  it("asks the provider for the anchor's justified balances", () => {
    const calls: {epoch: number; root: Uint8Array}[] = [];
    createForkChoice({
      justifiedBalances: (epoch, checkpointRoot) => {
        calls.push({epoch, root: checkpointRoot.slice()});
        return new Uint16Array(VALIDATOR_COUNT).fill(32);
      },
    });
    expect(calls).toEqual([anchorCheckpoint]);
  });

  it("propagates a provider failure", () => {
    expect(() =>
      createForkChoice({
        justifiedBalances: () => {
          throw Error("no state");
        },
      })
    ).toThrow("no state");
  });

  it("follows votes once their slot is past", () => {
    const forkChoice = createForkChoice();
    forkChoice.onTick(forkChoice.timeAtSlotMs(1));
    // Late arrivals, so neither block is boosted
    const late = {arrivalMsIntoSlot: chainConfig.SLOT_DURATION_MS - 1};
    expect(forkChoice.onBlock(summary(0x0a, ANCHOR, 1, late))).toBe(1);
    expect(forkChoice.onBlock(summary(0x0b, ANCHOR, 1, late))).toBe(2);
    expect(forkChoice.parentNode(2)).toBe(pendingNode(0));
    // Without votes the higher root wins
    expect(forkChoice.getHead()).toBe(pendingNode(2));

    forkChoice.onAttestation(1, 0, root(0x0a), 0, ANCHOR, Uint32Array.from([0, 1, 2]), false);
    expect(forkChoice.queuedVoteCount).toBe(3);
    expect(forkChoice.getHead()).toBe(pendingNode(2));

    forkChoice.onTick(forkChoice.timeAtSlotMs(2));
    expect(forkChoice.queuedVoteCount).toBe(0);
    expect(forkChoice.getHead()).toBe(pendingNode(1));
    expect(forkChoice.weights()[pendingNode(1)]).toBe(3n * GWEI_PER_VALIDATOR);
    expect(forkChoice.attestationScores()[pendingNode(0)]).toBe(3n * GWEI_PER_VALIDATOR);
    expect(forkChoice.bestChildren()[pendingNode(0)]).toBe(pendingNode(1));
    expect(forkChoice.bestChildren()[pendingNode(1)]).toBe(NO_NODE);

    const {slots, nodes} = forkChoice.latestMessages();
    expect(Array.from(nodes)).toEqual([pendingNode(1), pendingNode(1), pendingNode(1)]);
    expect(Array.from(slots)).toEqual([1, 1, 1]);
    expect(forkChoice.viableHeads().map((head) => head.root[0])).toEqual([0x0a, 0x0b]);
  });

  it("judges timeliness by the arrival time it is given", () => {
    const forkChoice = createForkChoice();
    forkChoice.onTick(forkChoice.timeAtSlotMs(1));
    const late = forkChoice.onBlock(summary(0x0a, ANCHOR, 1, {arrivalMsIntoSlot: chainConfig.SLOT_DURATION_MS - 1}));
    const timely = forkChoice.onBlock(summary(0x0b, ANCHOR, 1, {arrivalMsIntoSlot: 0}));
    expect(forkChoice.blockTimeliness(late)).toEqual([false, false]);
    expect(forkChoice.blockTimeliness(timely)).toEqual([true, true]);
    expect(Array.from(forkChoice.proposerBoostRoot)).toEqual(Array.from(root(0x0b)));
  });

  it("does not move time backwards", () => {
    const forkChoice = createForkChoice();
    forkChoice.onTick(forkChoice.timeAtSlotMs(3));
    forkChoice.onTick(forkChoice.timeAtSlotMs(1));
    expect(forkChoice.currentSlot).toBe(3);
  });

  it("discounts equivocating validators", () => {
    const forkChoice = createForkChoice();
    forkChoice.onTick(forkChoice.timeAtSlotMs(1));
    forkChoice.onBlock(summary(0x0a, ANCHOR, 1));
    forkChoice.onBlock(summary(0x0b, ANCHOR, 1));
    forkChoice.onTick(forkChoice.timeAtSlotMs(2));
    forkChoice.onAttestation(1, 0, root(0x0a), 0, ANCHOR, Uint32Array.from([0, 1]), false);
    expect(forkChoice.getHead()).toBe(pendingNode(1));

    const data = {index: 0, slot: 1, source: anchorCheckpoint, target: anchorCheckpoint};
    forkChoice.onAttesterSlashing(
      {...data, beaconBlockRoot: root(0x0a)},
      Uint32Array.from([0, 1]),
      {...data, beaconBlockRoot: root(0x0b)},
      Uint32Array.from([0, 1, 5])
    );
    expect(forkChoice.equivocatingCount).toBe(2);
    expect(forkChoice.getHead()).toBe(pendingNode(2));

    expect(() =>
      forkChoice.onAttesterSlashing(
        {...data, beaconBlockRoot: root(0x0a)},
        Uint32Array.from([3]),
        {...data, beaconBlockRoot: root(0x0a)},
        Uint32Array.from([3])
      )
    ).toThrow("NotSlashableAttestationData");
  });

  it("reports why the head is kept for a proposal", () => {
    const forkChoice = createForkChoice();
    forkChoice.onTick(forkChoice.timeAtSlotMs(1));
    forkChoice.onBlock(summary(0x0a, ANCHOR, 1, {arrivalMsIntoSlot: 0}));
    forkChoice.onTick(forkChoice.timeAtSlotMs(2));
    expect(forkChoice.getProposerHead(forkChoice.getHead(), 2)).toBe("head_timely");
  });

  it("prunes to the finalized block and reports where blocks moved", () => {
    const forkChoice = createForkChoice();
    expect(forkChoice.prune()).toBeUndefined();

    forkChoice.onTick(forkChoice.timeAtSlotMs(SLOTS_PER_EPOCH));
    forkChoice.onBlock(summary(0x0a, ANCHOR, 1));
    const finalized = {epoch: 1, root: root(0x0b)};
    forkChoice.onBlock(summary(0x0b, ANCHOR, SLOTS_PER_EPOCH));
    forkChoice.onTick(forkChoice.timeAtSlotMs(SLOTS_PER_EPOCH + 1));
    forkChoice.onBlock(
      summary(0x0c, root(0x0b), SLOTS_PER_EPOCH + 1, {finalizedCheckpoint: finalized, justifiedCheckpoint: finalized})
    );
    expect(forkChoice.checkpoints().finalized).toEqual(finalized);
    expect(forkChoice.isFinalizedDescendant(1)).toBe(false);
    expect(forkChoice.isFinalizedDescendant(3)).toBe(true);

    const remap = forkChoice.prune();
    expect(Array.from(remap ?? [])).toEqual([NO_BLOCK, NO_BLOCK, 0, 1]);
    expect(forkChoice.blockCount).toBe(2);
    expect(forkChoice.blockIndex(root(0x0c))).toBe(1);
    expect(forkChoice.getHead()).toBe(pendingNode(1));
  });

  it("rejects what the store rejects", () => {
    const forkChoice = createForkChoice();
    forkChoice.onTick(forkChoice.timeAtSlotMs(1));
    expect(() => forkChoice.onBlock(summary(0x0a, root(0x77), 1))).toThrow("UnknownParent");
    expect(() => forkChoice.onBlock(summary(0x0a, ANCHOR, 2))).toThrow("FutureBlock");
    expect(() => forkChoice.onBlock(summary(0x0a, ANCHOR, 1, {executionStatus: ExecutionStatus.Valid}))).toThrow(
      "ExecutionStatusMismatch"
    );
    expect(() => forkChoice.onAttestation(1, 0, root(0x55), 0, ANCHOR, Uint32Array.from([0]), false)).toThrow(
      "UnknownAttestationBlock"
    );
    expect(forkChoice.blockCount).toBe(1);
  });

  it("validates JavaScript-controlled arguments", () => {
    const forkChoice = createForkChoice();
    expect(() => forkChoice.parentNode(1)).toThrow("InvalidBlockIndex");
    expect(() => forkChoice.getAncestor(3, 0)).toThrow("InvalidNodeId");
    expect(() => forkChoice.blockIndex(new Uint8Array(31))).toThrow("InvalidRootLength");
    expect(() => forkChoice.onBlock(summary(0x0a, new Uint8Array(4), 0))).toThrow("InvalidRootLength");
    expect(() => forkChoice.onExecutionPayload(ANCHOR, 9)).toThrow("InvalidExecutionStatus");
    expect(() => forkChoice.shouldBuildOnFull(pendingNode(0), 1)).toThrow("PendingHeadNode");
    expect(
      () =>
        new ForkChoice(new bindings.BeaconConfig(chainConfig, new Uint8Array(32)), 0, summary(1, root(0), 0), {
          justifiedBalances: () => new Uint16Array(0),
        } as unknown as StateProvider)
    ).toThrow("InvalidProvider");
  });
});
