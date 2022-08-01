import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {fromHexString} from "@chainsafe/ssz";
import {RootHex} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ForkChoice, IForkChoiceStore, ProtoBlock, ProtoArray, ExecutionStatus} from "../../../src/index.js";

describe("Forkchoice", function () {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

  // missing 2 last chars
  const stateRootPrefix = "0xb021a96da54dd89dfafc0e8817e23fe708f5746e924855f49b3f978133c3ac";
  const finalizedRoot = "0x86d2ebb56a21be95b9036f4596ff4feaa336acf5fd8739cf39f5d58955b1295b";
  const parentRoot = "0x853d08094d83f1db67159144db54ec0c882eb9715184c4bde8f4191c926a1671";
  // missing 2 last chars
  const blockRootPrefix = "0x37487efdbfbeeb82d7d35c6eb96438c4576f645b0f4c0386184592abab4b17";
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
      } as Omit<ProtoBlock, "targetRoot">,
      genesisSlot
    );
  });

  const fcStore: IForkChoiceStore = {
    currentSlot: genesisSlot + 1,
    justified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      balances: new Uint8Array([32]),
    },
    bestJustified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      balances: new Uint8Array([32]),
    },
    unrealizedJustified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      balances: new Uint8Array([32]),
    },
    finalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
    unrealizedFinalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
    justifiedBalancesGetter: () => new Uint8Array([32]),
  };

  const getBlockRoot = (slot: number): RootHex => {
    if (slot === genesisSlot) return finalizedRoot;
    return blockRootPrefix + (slot < 10 ? "0" + slot : slot);
  };

  const getStateRoot = (slot: number): RootHex => {
    return stateRootPrefix + (slot < 10 ? "0" + slot : slot);
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
    while (targetSlot > 0) {
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

  it("getAllAncestorBlocks", function () {
    // Add block that is a finalized descendant.
    const block = getBlock(genesisSlot + 1);
    protoArr.onBlock(block, block.slot);
    const forkchoice = new ForkChoice(config, fcStore, protoArr);
    const summaries = forkchoice.getAllAncestorBlocks(getBlockRoot(genesisSlot + 1));
    // there are 2 blocks in protoArray but iterateAncestorBlocks should only return non-finalized blocks
    expect(summaries.length).to.be.equals(1, "should not return the finalized block");
    expect(summaries[0]).to.be.deep.include(block, "the block summary is not correct");
  });

  const dependentRootTestCases = [
    {name: "no skipped lot", skippedSlots: [], pivotSlot: 31},
    {name: "skipped pivot slot 31", skippedSlots: [31], pivotSlot: 30},
    {name: "skipped pivot slot 31, 30", skippedSlots: [31, 30], pivotSlot: 29},
    {name: "skipped slot 33 to 64", skippedSlots: Array.from({length: 32}, (_, i) => i + 33), pivotSlot: 31},
    {name: "skipped slot 32 to 64", skippedSlots: Array.from({length: 33}, (_, i) => i + 32), pivotSlot: 31},
    {name: "skipped slot 31 to 64", skippedSlots: Array.from({length: 34}, (_, i) => i + 31), pivotSlot: 30},
    {name: "skipped slot 30 to 64", skippedSlots: Array.from({length: 35}, (_, i) => i + 30), pivotSlot: 29},
  ];

  for (const {name, skippedSlots, pivotSlot} of dependentRootTestCases) {
    it(`findAttesterDependentRoot - ${name}`, () => {
      const slot = 2 * 32 + 5;
      populateProtoArray(slot, skippedSlots);
      const forkchoice = new ForkChoice(config, fcStore, protoArr);
      const blockRoot = getBlockRoot(slot);
      const pivotRoot = getBlockRoot(pivotSlot);
      expect(forkchoice.findAttesterDependentRoot(fromHexString(blockRoot))).to.be.equal(
        pivotRoot,
        "incorrect attester dependent root"
      );
    });
  }

  // TODO: more unit tests for other apis
});
