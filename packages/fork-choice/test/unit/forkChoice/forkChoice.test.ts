import {describe, it, expect, beforeEach, beforeAll} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {RootHex, Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  ForkChoice,
  IForkChoiceStore,
  ProtoBlock,
  ProtoArray,
  ExecutionStatus,
  EpochDifference,
  DataAvailabilityStatus,
} from "../../../src/index.js";
import {getBlockRoot, getStateRoot} from "../../utils/index.js";

describe("Forkchoice", () => {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const finalizedRoot = getBlockRoot(genesisSlot);
  const parentRoot = toHex(Buffer.alloc(32, 0xff));
  let protoArr: ProtoArray;

  beforeEach(() => {
    protoArr = ProtoArray.initialize(
      {
        slot: genesisSlot,
        stateRoot: getStateRoot(genesisSlot),
        parentRoot,
        blockRoot: finalizedRoot,

        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,

        executionPayloadBlockHash: null,
        executionStatus: ExecutionStatus.PreMerge,
        dataAvailabilityStatus: DataAvailabilityStatus.PreData,
      } as Omit<ProtoBlock, "targetRoot">,
      genesisSlot
    );
  });

  const fcStore: IForkChoiceStore = {
    currentSlot: genesisSlot + 1,
    justified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      balances: new Uint16Array([32]),
      totalBalance: 32,
    },
    unrealizedJustified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      balances: new Uint16Array([32]),
    },
    finalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
    unrealizedFinalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
    justifiedBalancesGetter: () => new Uint16Array([32]),
    equivocatingIndices: new Set(),
  };

  const getParentBlockRoot = (slot: number, skippedSlots: number[] = []): RootHex => {
    slot -= 1;
    while (slot >= 0) {
      if (!skippedSlots.includes(slot)) return getBlockRoot(slot);
      slot -= 1;
    }
    throw Error("Not found parent slot for slot" + slot);
  };

  const getTargetRoot = (slot: number, skippedSlots: number[] = []): RootHex => {
    let targetSlot = computeEpochAtSlot(slot) * SLOTS_PER_EPOCH;
    if (targetSlot === genesisSlot) return finalizedRoot;
    while (targetSlot >= 0) {
      if (!skippedSlots.includes(targetSlot)) return getBlockRoot(targetSlot);
      targetSlot -= 1;
    }
    throw Error("Not found target slot for slot " + slot);
  };

  const getBlock = (slot: number, skippedSlots: number[] = []): ProtoBlock => {
    return {
      slot,
      blockRoot: getBlockRoot(slot),
      parentRoot: getParentBlockRoot(slot, skippedSlots),
      stateRoot: getStateRoot(slot),
      targetRoot: getTargetRoot(slot, skippedSlots),

      justifiedEpoch: genesisEpoch,
      justifiedRoot: genesisRoot,
      finalizedEpoch: genesisEpoch,
      finalizedRoot: genesisRoot,
      unrealizedJustifiedEpoch: genesisEpoch,
      unrealizedJustifiedRoot: genesisRoot,
      unrealizedFinalizedEpoch: genesisEpoch,
      unrealizedFinalizedRoot: genesisRoot,

      executionPayloadBlockHash: null,
      executionStatus: ExecutionStatus.PreMerge,

      timeliness: false,
      dataAvailabilityStatus: DataAvailabilityStatus.PreData,
    };
  };

  const populateProtoArray = (tillSlot: number, skippedSlots: number[] = []): void => {
    for (let slot = genesisSlot + 1; slot <= tillSlot; slot++) {
      if (!skippedSlots.includes(slot)) {
        const block = getBlock(slot, skippedSlots);
        protoArr.onBlock(block, block.slot);
      }
    }
  };

  it("getAllAncestorBlocks", () => {
    // Add block that is a finalized descendant.
    const block = getBlock(genesisSlot + 1);
    protoArr.onBlock(block, block.slot);
    const forkchoice = new ForkChoice(config, fcStore, protoArr);
    const summaries = forkchoice.getAllAncestorBlocks(getBlockRoot(genesisSlot + 1));
    // there are 2 blocks in protoArray but iterateAncestorBlocks should only return non-finalized blocks
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toEqual({...block, bestChild: undefined, bestDescendant: undefined, parent: 0, weight: 0});
  });

  beforeAll(() => {
    expect(SLOTS_PER_EPOCH).toBe(32);
  });

  const dependentRootTestCases: {atSlot: Slot; pivotSlot: Slot; epoch: EpochDifference; skipped: Slot[]}[] = [
    // First slot in epoch request, EpochDifference.current
    {atSlot: 32, pivotSlot: 31, epoch: EpochDifference.current, skipped: []},
    {atSlot: 32, pivotSlot: 30, epoch: EpochDifference.current, skipped: [31]},
    {atSlot: 32, pivotSlot: 8, epoch: EpochDifference.current, skipped: range(9, 31)},
    {atSlot: 32, pivotSlot: 0, epoch: EpochDifference.current, skipped: range(1, 31)},
    // First slot in epoch request, EpochDifference.previous
    {atSlot: 64, pivotSlot: 31, epoch: EpochDifference.previous, skipped: []},
    {atSlot: 64, pivotSlot: 30, epoch: EpochDifference.previous, skipped: [31]},
    {atSlot: 64, pivotSlot: 8, epoch: EpochDifference.previous, skipped: range(9, 32)},
    {atSlot: 64, pivotSlot: 0, epoch: EpochDifference.previous, skipped: range(1, 32)},
    // Mid slot in epoch request, EpochDifference.previous
    {atSlot: 64 + 1, pivotSlot: 31, epoch: EpochDifference.previous, skipped: []},
    {atSlot: 64 + 8, pivotSlot: 31, epoch: EpochDifference.previous, skipped: []},
    {atSlot: 64 + 31, pivotSlot: 31, epoch: EpochDifference.previous, skipped: []},
    // Underflow up to genesis
    {atSlot: 31, pivotSlot: 0, epoch: EpochDifference.current, skipped: []},
    {atSlot: 8, pivotSlot: 0, epoch: EpochDifference.current, skipped: []},
    {atSlot: 0, pivotSlot: 0, epoch: EpochDifference.current, skipped: []},
    {atSlot: 32, pivotSlot: 0, epoch: EpochDifference.previous, skipped: []},
    {atSlot: 8, pivotSlot: 0, epoch: EpochDifference.previous, skipped: []},
    {atSlot: 0, pivotSlot: 0, epoch: EpochDifference.previous, skipped: []},
  ];

  for (const {atSlot, pivotSlot, epoch, skipped} of dependentRootTestCases) {
    it(`getDependentRoot epoch ${epoch} atSlot ${atSlot} skipped ${JSON.stringify(skipped)}`, () => {
      populateProtoArray(atSlot, skipped);
      const forkchoice = new ForkChoice(config, fcStore, protoArr);

      const blockRoot = getBlockRoot(atSlot);
      const block = forkchoice.getBlockHex(blockRoot);
      if (!block) throw Error(`No block for blockRoot ${blockRoot}`);

      const expectedDependentRoot = getBlockRoot(pivotSlot);

      expect(forkchoice.getDependentRoot(block, epoch)).toBe(expectedDependentRoot);
    });
  }

  // TODO: more unit tests for other apis
});

function range(from: number, toInclusive: number): number[] {
  const arr: number[] = [];
  for (let i = from; i <= toInclusive; i++) {
    arr.push(i);
  }
  return arr;
}
