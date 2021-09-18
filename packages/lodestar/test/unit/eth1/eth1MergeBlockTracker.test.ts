import {AbortController} from "@chainsafe/abort-controller";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {sleep} from "@chainsafe/lodestar-utils";
import {expect} from "chai";
import {IEth1Provider} from "../../../src";
import {Eth1MergeBlockTracker, StatusCode, toPowBlock} from "../../../src/eth1/eth1MergeBlockTracker";
import {EthJsonRpcBlockRaw} from "../../../src/eth1/interface";
import {testLogger} from "../../utils/logger";

/* eslint-disable @typescript-eslint/naming-convention */

describe("eth1 / Eth1MergeBlockTracker", () => {
  const logger = testLogger();
  const notImplemented = async (): Promise<any> => {
    throw Error("Not implemented");
  };

  // Set time units to 0 to make the test as fast as possible
  const config = ({
    SECONDS_PER_ETH1_BLOCK: 0,
    SECONDS_PER_SLOT: 0,
  } as Partial<IChainConfig>) as IChainConfig;

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Should find merge block polling future 'latest' blocks", async () => {
    const terminalTotalDifficulty = 1000;
    // Set current network totalDifficulty to behind terminalTotalDifficulty by 5.
    // Then on each call to getBlockByNumber("latest") increase totalDifficulty by 1.
    const difficultyOffset = 5;
    const totalDifficulty = terminalTotalDifficulty - difficultyOffset;

    let latestBlockPointer = 0;
    const blocks: EthJsonRpcBlockRaw[] = [];
    const blocksByHash = new Map<string, EthJsonRpcBlockRaw>();

    function getLatestBlock(i: number): EthJsonRpcBlockRaw {
      const block: EthJsonRpcBlockRaw = {
        number: toHex(i),
        hash: toRootHex(i + 1),
        parentHash: toRootHex(i),
        difficulty: "0x0",
        // Latest block is under TTD, so past block search is stopped
        totalDifficulty: toHex(totalDifficulty + i),
        timestamp: "0x0",
      };
      blocks.push(block);
      blocksByHash.set(block.hash, block);
      return block;
    }

    const eth1Provider: IEth1Provider = {
      deployBlock: 0,
      getBlockNumber: async () => 0,
      getBlockByNumber: async (blockNumber) => {
        // On each call simulate that the eth1 chain advances 1 block with +1 totalDifficulty
        if (blockNumber === "latest") return getLatestBlock(latestBlockPointer++);
        return blocks[blockNumber];
      },
      getBlockByHash: async (blockHashHex) => blocksByHash.get(blockHashHex) ?? null,
      getBlocksByNumber: notImplemented,
      getDepositEvents: notImplemented,
      validateContract: notImplemented,
    };

    const eth1MergeBlockTracker = new Eth1MergeBlockTracker(
      {
        transitionStore: {initialized: true, terminalTotalDifficulty: BigInt(terminalTotalDifficulty)},
        config,
        logger,
        signal: controller.signal,
        clockEpoch: 0,
        isMergeComplete: false,
      },
      eth1Provider as IEth1Provider
    );

    // Wait for Eth1MergeBlockTracker to find at least one merge block
    while (!controller.signal.aborted) {
      if (eth1MergeBlockTracker.getMergeBlock()) break;
      await sleep(10, controller.signal);
    }

    // Status should acknowlege merge block is found
    expect(eth1MergeBlockTracker["status"]).to.equal(StatusCode.FOUND, "Wrong StatusCode");

    // Given the total difficulty offset the block that has TTD is the `difficultyOffset`nth block
    expect(eth1MergeBlockTracker.getMergeBlock()).to.deep.equal(
      toPowBlock(blocks[difficultyOffset]),
      "Wrong found merge block"
    );
  });

  it("Should find merge block fetching past blocks", async () => {
    const terminalTotalDifficulty = 1000;
    // Set current network totalDifficulty to behind terminalTotalDifficulty by 5.
    // Then on each call to getBlockByNumber("latest") increase totalDifficulty by 1.
    const difficultyOffset = 5;
    const totalDifficulty = terminalTotalDifficulty - difficultyOffset;

    const blocks: EthJsonRpcBlockRaw[] = [];
    const blocksByHash = new Map<string, EthJsonRpcBlockRaw>();

    for (let i = 0; i < difficultyOffset * 2; i++) {
      const block: EthJsonRpcBlockRaw = {
        number: toHex(i),
        hash: toRootHex(i + 1),
        parentHash: toRootHex(i),
        difficulty: "0x0",
        // Latest block is under TTD, so past block search is stopped
        totalDifficulty: toHex(totalDifficulty + i),
        timestamp: "0x0",
      };
      blocks.push(block);
      blocksByHash.set(block.hash, block);
    }

    // Return a latest block that's over TTD but its parent doesn't exit to cancel future searches
    const latestBlock: EthJsonRpcBlockRaw = {
      ...blocks[blocks.length - 1],
      parentHash: toRootHex(0xffffffff),
    };

    const eth1Provider: IEth1Provider = {
      deployBlock: 0,
      getBlockNumber: async () => 0,
      getBlockByNumber: async (blockNumber) => {
        // Always return the same block with totalDifficulty > TTD and unknown parent
        if (blockNumber === "latest") return latestBlock;
        return blocks[blockNumber];
      },
      getBlockByHash: async (blockHashHex) => blocksByHash.get(blockHashHex) ?? null,
      getBlocksByNumber: async (from, to) => blocks.slice(from, to),
      getDepositEvents: notImplemented,
      validateContract: notImplemented,
    };

    const eth1MergeBlockTracker = new Eth1MergeBlockTracker(
      {
        transitionStore: {initialized: true, terminalTotalDifficulty: BigInt(terminalTotalDifficulty)},
        config,
        logger,
        signal: controller.signal,
        clockEpoch: 0,
        isMergeComplete: false,
      },
      eth1Provider as IEth1Provider
    );

    // Wait for Eth1MergeBlockTracker to find at least one merge block
    while (!controller.signal.aborted) {
      if (eth1MergeBlockTracker.getMergeBlock()) break;
      await sleep(10, controller.signal);
    }

    // Status should acknowlege merge block is found
    expect(eth1MergeBlockTracker["status"]).to.equal(StatusCode.FOUND, "Wrong StatusCode");

    // Given the total difficulty offset the block that has TTD is the `difficultyOffset`nth block
    expect(eth1MergeBlockTracker.getMergeBlock()).to.deep.equal(
      toPowBlock(blocks[difficultyOffset]),
      "Wrong found merge block"
    );
  });
});

function toHex(num: number | bigint): string {
  return "0x" + num.toString(16);
}

function toRootHex(num: number): string {
  return "0x" + num.toString(16).padStart(64, "0");
}
