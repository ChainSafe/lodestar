import {beforeAll, beforeEach, describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, computeEpochAtSlot} from "@lodestar/state-transition";
import {RootHex, Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {
  EpochDifference,
  ExecutionStatus,
  ForkChoice,
  IForkChoiceStore,
  PayloadStatus,
  ProtoArray,
  ProtoBlock,
} from "../../../src/index.js";
import {getBlockRoot, getStateRoot} from "../../utils/index.js";

describe("Forkchoice", () => {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const finalizedRoot = getBlockRoot(genesisSlot);
  const parentRoot = toHex(Buffer.alloc(32, 0xff));
  let protoArr: ProtoArray;
  const validatorCount = 100;

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

        // Pre-Gloas block fields (required to avoid being treated as Gloas)
        parentBlockHash: null,
        payloadStatus: PayloadStatus.FULL,
        timeliness: false,
      } as Omit<ProtoBlock, "targetRoot">,
      genesisSlot
    );
  });

  const fcStore: IForkChoiceStore = {
    currentSlot: genesisSlot + 1,
    justified: {
      checkpoint: {
        epoch: genesisEpoch,
        root: fromHexString(finalizedRoot),
        rootHex: finalizedRoot,
      },
      balances: new Uint16Array([32]),
      totalBalance: 32,
    },
    unrealizedJustified: {
      checkpoint: {
        epoch: genesisEpoch,
        root: fromHexString(finalizedRoot),
        rootHex: finalizedRoot,
      },
      balances: new Uint16Array([32]),
    },
    finalizedCheckpoint: {
      epoch: genesisEpoch,
      root: fromHexString(finalizedRoot),
      rootHex: finalizedRoot,
    },
    unrealizedFinalizedCheckpoint: {
      epoch: genesisEpoch,
      root: fromHexString(finalizedRoot),
      rootHex: finalizedRoot,
    },
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

      parentBlockHash: null,
      payloadStatus: PayloadStatus.FULL,
    };
  };

  const populateProtoArray = (tillSlot: number, skippedSlots: number[] = []): void => {
    for (let slot = genesisSlot + 1; slot <= tillSlot; slot++) {
      if (!skippedSlots.includes(slot)) {
        const block = getBlock(slot, skippedSlots);
        protoArr.onBlock(block, block.slot, null);
      }
    }
  };

  it("getAllAncestorBlocks", () => {
    // Add block that is a finalized descendant.
    const block = getBlock(genesisSlot + 1);
    protoArr.onBlock(block, block.slot, null);
    const forkchoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null);
    const summaries = forkchoice.getAllAncestorBlocks(getBlockRoot(genesisSlot + 1), PayloadStatus.FULL);
    // Raw ancestor walk includes both the start and the previous-finalized boundary (genesis).
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toEqual({
      ...block,
      bestChild: undefined,
      bestDescendant: undefined,
      parent: 0,
      weight: 0,
      payloadStatus: 2, // Pre-Gloas blocks always have PAYLOAD_STATUS_FULL
    });
  });

  it("getAllAncestorAndNonAncestorBlocks returns the raw walk (boundary included) + nonAncestors", () => {
    // Create a simple chain: 0 -> 1 -> 2 -> 3
    populateProtoArray(genesisSlot + 3);

    // Create a fork by adding block 10 with parent at genesis
    const forkBlock = {
      ...getBlock(genesisSlot + 10),
      parentRoot: finalizedRoot, // Connect directly to genesis
    };
    protoArr.onBlock(forkBlock, forkBlock.slot, null);

    const forkchoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null);

    // Both `getAllAncestorBlocks` and the combined walker's `ancestors` include the previous
    // finalized boundary as the last element.
    const canonicalBlockRoot = getBlockRoot(genesisSlot + 3);
    const canonicalAncestorBlocks = forkchoice.getAllAncestorBlocks(canonicalBlockRoot, PayloadStatus.FULL);
    const canonicalNonAncestorBlocks = forkchoice.getAllNonAncestorBlocks(canonicalBlockRoot, PayloadStatus.FULL);
    const canonicalCombined = forkchoice.getAllAncestorAndNonAncestorBlocks(canonicalBlockRoot, PayloadStatus.FULL);

    expect(canonicalCombined.ancestors).toEqual(canonicalAncestorBlocks);
    expect(canonicalCombined.nonAncestors).toEqual(canonicalNonAncestorBlocks);

    const forkBlockRoot = getBlockRoot(genesisSlot + 10);
    const forkAncestorBlocks = forkchoice.getAllAncestorBlocks(forkBlockRoot, PayloadStatus.FULL);
    const forkNonAncestorBlocks = forkchoice.getAllNonAncestorBlocks(forkBlockRoot, PayloadStatus.FULL);
    const forkCombined = forkchoice.getAllAncestorAndNonAncestorBlocks(forkBlockRoot, PayloadStatus.FULL);

    expect(forkCombined.ancestors).toEqual(forkAncestorBlocks);
    expect(forkCombined.nonAncestors).toEqual(forkNonAncestorBlocks);
  });

  describe("getMaxWeightBlockAtSlot", () => {
    const siblingBlockRoot = toHex(Buffer.alloc(32, 0xcc));
    const buildSibling = (slot: number): ProtoBlock => ({
      ...getBlock(slot),
      blockRoot: siblingBlockRoot,
      stateRoot: toHex(Buffer.alloc(32, 0xdd)),
    });

    it("returns null when no block has been seen at slot", () => {
      populateProtoArray(genesisSlot + 2);
      const forkchoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null);
      expect(forkchoice.getMaxWeightBlockAtSlot(genesisSlot + 100)).toBeNull();
    });

    it("returns the block with strictly greater weight among siblings", () => {
      populateProtoArray(genesisSlot + 2);
      const sibling = buildSibling(genesisSlot + 2);
      protoArr.onBlock(sibling, sibling.slot, null);

      const forkchoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null);
      const canonical = forkchoice.getCanonicalBlockAtSlot(genesisSlot + 2);
      if (!canonical) throw Error("expected canonical block at slot 2");

      const siblingRoot = canonical.blockRoot === siblingBlockRoot ? getBlockRoot(genesisSlot + 2) : siblingBlockRoot;
      const siblingNode = protoArr.nodes.find((n) => n.blockRoot === siblingRoot && n.slot === genesisSlot + 2);
      if (!siblingNode) throw Error("expected sibling node");
      siblingNode.weight = 100;

      const result = forkchoice.getMaxWeightBlockAtSlot(genesisSlot + 2);
      expect(result?.blockRoot).toBe(siblingRoot);
    });

    it("prefers the canonical block on weight tie", () => {
      populateProtoArray(genesisSlot + 2);
      const sibling = buildSibling(genesisSlot + 2);
      protoArr.onBlock(sibling, sibling.slot, null);

      const forkchoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null);
      const canonical = forkchoice.getCanonicalBlockAtSlot(genesisSlot + 2);
      if (!canonical) throw Error("expected canonical block at slot 2");

      // Both nodes still have weight 0 — tie. Seeding with canonical means strict `>` cannot
      // displace it, regardless of insertion order in protoArray.nodes.
      const result = forkchoice.getMaxWeightBlockAtSlot(genesisSlot + 2);
      expect(result?.blockRoot).toBe(canonical.blockRoot);
    });
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
      const forkchoice = new ForkChoice(config, fcStore, protoArr, validatorCount, null);

      const blockRoot = getBlockRoot(atSlot);
      const block = forkchoice.getBlockHexDefaultStatus(blockRoot);
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
