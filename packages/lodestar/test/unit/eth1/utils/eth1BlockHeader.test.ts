import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {pick} from "lodash";
import {IEth1Block} from "../../../../src/eth1";
import {getCandidateBlocksFromStream} from "../../../../src/eth1/utils/eth1Block";
import {isCandidateBlock} from "../../../../src/eth1/utils/eth1Vote";
import {iteratorFromArray} from "../../../utils/interator";

type IEth1BlockNoHash = Pick<IEth1Block, "blockNumber" | "timestamp">;

describe("eth1 / util / getCandidateBlocksFromStream", function () {
  const {SECONDS_PER_ETH1_BLOCK, ETH1_FOLLOW_DISTANCE} = config.params;
  const eth1FollowDistanceSeconds = SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE;

  const testCases: {
    id: string;
    periodStart: number;
    blockHeaders: IEth1BlockNoHash[];
    expectedCandidateBlocks: IEth1BlockNoHash[];
  }[] = [
    {
      id: "regular case",
      periodStart: 4 * eth1FollowDistanceSeconds,
      blockHeaders: [
        {blockNumber: 1, timestamp: 1 * eth1FollowDistanceSeconds},
        {blockNumber: 2, timestamp: 2 * eth1FollowDistanceSeconds},
        {blockNumber: 3, timestamp: 3 * eth1FollowDistanceSeconds},
        {blockNumber: 4, timestamp: 4 * eth1FollowDistanceSeconds},
      ],
      expectedCandidateBlocks: [
        {blockNumber: 2, timestamp: 2 * eth1FollowDistanceSeconds},
        {blockNumber: 3, timestamp: 3 * eth1FollowDistanceSeconds},
      ],
    },
    {
      id: "empty case",
      periodStart: 0,
      blockHeaders: [],
      expectedCandidateBlocks: [],
    },
  ];

  for (const {id, periodStart, blockHeaders, expectedCandidateBlocks} of testCases) {
    it(id, async function () {
      // Make sure expectedCandidateBlocks is correct. `isCandidateBlock` is the literal spec function
      expect(blockHeaders.filter((block) => isCandidateBlock(config, block, periodStart))).to.deep.equal(
        expectedCandidateBlocks,
        "expectedCandidateBlocks is not correct"
      );

      const candidateBlocks = await getCandidateBlocksFromStream(
        config,
        periodStart,
        iteratorFromArray(blockHeaders.map(addBlockHash).reverse())
      );

      expect(candidateBlocks.map(removeBlockHash)).to.deep.equal(expectedCandidateBlocks);
    });
  }
});

function addBlockHash(block: IEth1BlockNoHash): IEth1Block {
  return {
    blockHash: new Uint8Array(Array(32).fill(block.blockNumber)),
    ...block,
  };
}

function removeBlockHash(block: IEth1Block): IEth1BlockNoHash {
  return pick(block, ["blockNumber", "timestamp"]);
}
