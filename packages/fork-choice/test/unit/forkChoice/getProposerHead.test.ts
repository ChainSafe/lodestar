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
  ProtoArray,
  ExecutionStatus,
  EpochDifference,
  ProtoBlock,
} from "../../../src/index.js";
import {getBlockRoot, getStateRoot} from "./forkChoice.test.js";

type ProtoBlockWithWeight = ProtoBlock & {weight: number}; // weight of the block itself

describe("Forkchoice / GetProposerHead", function () {
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
  };

  const fcStore: IForkChoiceStore = {
    currentSlot: genesisSlot + 1,
    justified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(genesisBlock.blockRoot), rootHex: genesisBlock.blockRoot},
      balances: new Uint8Array(Array(32).fill(150)),
    },
    unrealizedJustified: {
      checkpoint: {epoch: genesisEpoch, root: fromHexString(genesisBlock.blockRoot), rootHex: genesisBlock.blockRoot},
      balances: new Uint8Array(Array(32).fill(150)),
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
    justifiedBalancesGetter: () => new Uint8Array(Array(32).fill(150)),
    equivocatingIndices: new Set(),
  };

  // head block's weight < 30 is considered weak. parent block's total weight > 240 is considered strong
  const testCases: {
    id: string;
    parentBlock: ProtoBlockWithWeight;
    headBlock: ProtoBlockWithWeight;
    expectReorg: boolean;
    currentSlot?: Slot;
  }[] = [
    {
      id: "Case that meets all conditions to be re-orged",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock},
      expectReorg: true,
    },
    {
      id: "No reorg when head block is timly",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, timeliness: true},
      expectReorg: false,
    },
    {
      id: "No reorg when currenSlot is at epoch boundary",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock},
      expectReorg: false,
      currentSlot: SLOTS_PER_EPOCH * 2,
    },
    {
      id: "No reorg when the blocks are not ffg competitive",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, unrealizedJustifiedEpoch: 1},
      expectReorg: false,
    },
    {
      id: "No reorg when the blocks are not ffg competitive 2",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, unrealizedJustifiedRoot: "-"},
      expectReorg: false,
    },
    {
      id: "No reorg if long unfinality",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock},
      expectReorg: false,
      currentSlot: (genesisEpoch + 2) * SLOTS_PER_EPOCH + 1,
    },
    {
      id: "No reorg if reorg spans more than a single slot",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, slot: headSlot + 1},
      expectReorg: false,
    },
    {
      id: "No reorg if current slot is more than one slot from head block",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock},
      expectReorg: false,
      currentSlot: headSlot + 2,
    },
    {
      id: "No reorg if head is strong",
      parentBlock: {...baseParentHeadBlock},
      headBlock: {...baseHeadBlock, weight: 30},
      expectReorg: false,
    },
    {
      id: "No reorg if parent is weak",
      parentBlock: {...baseParentHeadBlock, weight: 211},
      headBlock: {...baseHeadBlock},
      expectReorg: false,
    },
  ];

  beforeEach(() => {
    protoArr = ProtoArray.initialize(genesisBlock, genesisSlot);
  });

  for (const {id, parentBlock, headBlock, expectReorg, currentSlot: proposalSlot} of testCases) {
    it(`${id}`, async () => {
      protoArr.onBlock(parentBlock, parentBlock.slot);
      protoArr.onBlock(headBlock, headBlock.slot);

      const currentSlot = proposalSlot ?? headBlock.slot + 1;
      protoArr.applyScoreChanges({
        deltas: [0, parentBlock.weight, headBlock.weight],
        proposerBoost: null,
        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
        currentSlot,
      });

      const forkChoice = new ForkChoice(config, fcStore, protoArr, undefined, {
        proposerBoostEnabled: true,
        proposerBoostReorgEnabled: true,
      });

      const proposerHead = forkChoice.getProposerHead(headBlock, currentSlot);

      expect(proposerHead.blockRoot).toBe(expectReorg ? parentBlock.blockRoot : headBlock.blockRoot);
    });
  }
});
