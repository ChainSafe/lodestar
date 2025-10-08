import {beforeEach, describe, expect, it} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {NotReorgedReason} from "../../../src/forkChoice/interface.js";
import {ExecutionStatus, ForkChoice, IForkChoiceStore, ProtoArray, ProtoBlock} from "../../../src/index.js";
import {getBlockRoot, getStateRoot} from "../../utils/index.js";

type ProtoBlockWithWeight = ProtoBlock & {weight: number}; // weight of the block itself

describe("Forkchoice / shouldOverrideForkChoiceUpdate", () => {
  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const parentSlot = genesisSlot + 1;
  const headSlot = genesisSlot + 2;

  let protoArr: ProtoArray;

  const genesisBlock: Omit<ProtoBlock, "targetRoot"> = {
    slot: genesisSlot,
    stateRoot: getStateRoot(genesisSlot),
    parentRoot: toHex(Buffer.alloc(32, 0xff)),
    blockRoot: getBlockRoot(genesisSlot),

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

  const baseHeadBlock: ProtoBlockWithWeight = {
    slot: headSlot,
    stateRoot: getStateRoot(headSlot),
    parentRoot: getBlockRoot(parentSlot),
    blockRoot: getBlockRoot(headSlot),
    targetRoot: getBlockRoot(headSlot),

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

    weight: 29,
    dataAvailabilityStatus: DataAvailabilityStatus.PreData,
  };

  const baseParentHeadBlock: ProtoBlockWithWeight = {
    slot: parentSlot,
    stateRoot: getStateRoot(parentSlot),
    parentRoot: getBlockRoot(genesisSlot),
    blockRoot: getBlockRoot(parentSlot),
    targetRoot: getBlockRoot(parentSlot),

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
    weight: 212, // 240 - 29 + 1
    dataAvailabilityStatus: DataAvailabilityStatus.PreData,
  };

  const fcStore: IForkChoiceStore = {
    currentSlot: genesisSlot + 1,
    justified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(genesisBlock.blockRoot), rootHex: genesisBlock.blockRoot},
      balances: new Uint16Array(Array(32).fill(150)),
      totalBalance: 32 * 150,
    },
    unrealizedJustified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(genesisBlock.blockRoot), rootHex: genesisBlock.blockRoot},
      balances: new Uint16Array(Array(32).fill(150)),
    },
    finalizedCheckpoint: {
      epoch: genesisEpoch,
      root: fromHexString(genesisBlock.blockRoot),
      rootHex: genesisBlock.blockRoot,
    },
    unrealizedFinalizedCheckpoint: {
      epoch: genesisEpoch,
      root: fromHexString(genesisBlock.blockRoot),
      rootHex: genesisBlock.blockRoot,
    },
    justifiedBalancesGetter: () => new Uint16Array(Array(32).fill(150)),
    equivocatingIndices: new Set(),
  };

  const testCases: {
    id: string;
    parentBlock: ProtoBlockWithWeight;
    headBlock: ProtoBlockWithWeight;
    expectReorg: boolean;
    currentSlot?: Slot;
    expectedNotReorgedReason?: NotReorgedReason;
  }[] = [
    {
      id: "Case that meets all conditions to be re-orged",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock},
      expectReorg: true,
    },
    {
      id: "No reorg when head block is timely",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, timeliness: true},
      expectReorg: false,
      expectedNotReorgedReason: NotReorgedReason.HeadBlockIsTimely,
    },
    {
      id: "No reorg when proposal slot is at epoch boundary",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, slot: SLOTS_PER_EPOCH * 2 - 1}, // Proposal slot = block slot + 1
      expectReorg: false,
      expectedNotReorgedReason: NotReorgedReason.NotShufflingStable,
    },
    {
      id: "No reorg when the blocks are not ffg competitive",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, unrealizedJustifiedEpoch: 1},
      expectReorg: false,
      expectedNotReorgedReason: NotReorgedReason.NotFFGCompetitive,
    },
    {
      id: "No reorg when the blocks are not ffg competitive 2",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, unrealizedJustifiedRoot: "-"},
      expectReorg: false,
      expectedNotReorgedReason: NotReorgedReason.NotFFGCompetitive,
    },
    {
      id: "No reorg if long unfinality",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock},
      expectReorg: false,
      currentSlot: (genesisEpoch + 2) * SLOTS_PER_EPOCH + 1,
      expectedNotReorgedReason: NotReorgedReason.ReorgMoreThanOneSlot, // TODO: To make it such that it returns NotReorgedReason.ChainLongUnfinality
    },
    {
      id: "No reorg if reorg spans more than a single slot",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, slot: headSlot + 1},
      expectReorg: false,
      expectedNotReorgedReason: NotReorgedReason.ParentBlockDistanceMoreThanOneSlot,
    },
  ];

  beforeEach(() => {
    protoArr = ProtoArray.initialize(genesisBlock, genesisSlot);
  });

  for (const {
    id,
    parentBlock,
    headBlock,
    expectReorg,
    currentSlot: blockSeenSlot,
    expectedNotReorgedReason,
  } of testCases) {
    it(id, async () => {
      protoArr.onBlock(parentBlock, parentBlock.slot);
      protoArr.onBlock(headBlock, headBlock.slot);

      const secFromSlot = 0;
      const currentSlot = blockSeenSlot ?? headBlock.slot;
      const forkChoice = new ForkChoice(config, fcStore, protoArr, null, {
        proposerBoost: true,
        proposerBoostReorg: true,
      });

      const result = forkChoice.shouldOverrideForkChoiceUpdate(headBlock.blockRoot, secFromSlot, currentSlot);

      expect(result.shouldOverrideFcu).toBe(expectReorg);

      if (result.shouldOverrideFcu) {
        expect(result.parentBlock.blockRoot).toBe(parentBlock.blockRoot);
      } else {
        expect(result.reason).toBe(expectedNotReorgedReason);
      }
    });
  }
});
