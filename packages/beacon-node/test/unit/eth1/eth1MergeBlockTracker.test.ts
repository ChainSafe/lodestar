import {expect} from "chai";
import {ChainConfig} from "@lodestar/config";
import {sleep} from "@lodestar/utils";
import {toHexString} from "@chainsafe/ssz";
import {IEth1Provider} from "../../../src/index.js";
import {ZERO_HASH} from "../../../src/constants/index.js";
import {Eth1MergeBlockTracker, StatusCode, toPowBlock} from "../../../src/eth1/eth1MergeBlockTracker.js";
import {EthJsonRpcBlockRaw} from "../../../src/eth1/interface.js";
import {testLogger} from "../../utils/logger.js";

/* eslint-disable @typescript-eslint/naming-convention */

describe("eth1 / Eth1MergeBlockTracker", () => {
  const logger = testLogger();

  const terminalTotalDifficulty = 1000;
  let config: ChainConfig;
  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());
  beforeEach(() => {
    config = ({
      // Set time units to 0 to make the test as fast as possible
      SECONDS_PER_ETH1_BLOCK: 0,
      SECONDS_PER_SLOT: 0,
      // Hardcode TTD to a low value
      TERMINAL_TOTAL_DIFFICULTY: BigInt(terminalTotalDifficulty),
      TERMINAL_BLOCK_HASH: ZERO_HASH,
    } as Partial<ChainConfig>) as ChainConfig;
  });

  it("Should find terminal pow block through TERMINAL_BLOCK_HASH", async () => {
    config.TERMINAL_BLOCK_HASH = Buffer.alloc(1, 32);
    const block: EthJsonRpcBlockRaw = {
      number: toHex(10),
      hash: toRootHex(11),
      parentHash: toRootHex(10),
      totalDifficulty: toHex(100),
      timestamp: "0x0",
    };
    const terminalPowBlock = toPowBlock(block);
    const eth1Provider: IEth1Provider = {
      deployBlock: 0,
      getBlockNumber: async () => 0,
      getBlockByNumber: async () => {
        throw Error("Not implemented");
      },
      getBlockByHash: async (blockHashHex): Promise<EthJsonRpcBlockRaw | null> => {
        return blockHashHex === toHexString(config.TERMINAL_BLOCK_HASH) ? block : null;
      },
      getBlocksByNumber: async (): Promise<any> => {
        throw Error("Not implemented");
      },
      getDepositEvents: async (): Promise<any> => {
        throw Error("Not implemented");
      },
      validateContract: async (): Promise<any> => {
        throw Error("Not implemented");
      },
    };

    const eth1MergeBlockTracker = new Eth1MergeBlockTracker(
      {
        config,
        logger,
        signal: controller.signal,
        metrics: null,
      },
      eth1Provider as IEth1Provider
    );
    eth1MergeBlockTracker.startPollingMergeBlock();

    // Wait for Eth1MergeBlockTracker to find at least one merge block
    while (!controller.signal.aborted) {
      if (await eth1MergeBlockTracker.getTerminalPowBlock()) break;
      await sleep(10, controller.signal);
    }

    // Status should acknowlege merge block is found
    expect(eth1MergeBlockTracker["status"].code).to.equal(StatusCode.FOUND, "Wrong StatusCode");

    // Given the total difficulty offset the block that has TTD is the `difficultyOffset`nth block
    expect(await eth1MergeBlockTracker.getTerminalPowBlock()).to.deep.equal(
      terminalPowBlock,
      "Wrong found terminal pow block"
    );
  });

  it("Should find terminal pow block polling future 'latest' blocks", async () => {
    // Set current network totalDifficulty to behind terminalTotalDifficulty by 5.
    // Then on each call to getBlockByNumber("latest") increase totalDifficulty by 1.
    const numOfBlocks = 5;
    const difficulty = 1;

    let latestBlockPointer = 0;

    const blocks: EthJsonRpcBlockRaw[] = [];
    const blocksByHash = new Map<string, EthJsonRpcBlockRaw>();

    for (let i = 0; i < numOfBlocks + 1; i++) {
      const block: EthJsonRpcBlockRaw = {
        number: toHex(i),
        hash: toRootHex(i + 1),
        parentHash: toRootHex(i),
        // Latest block is under TTD, so past block search is stopped
        totalDifficulty: toHex(terminalTotalDifficulty - numOfBlocks * difficulty + i * difficulty),
        timestamp: "0x0",
      };
      blocks.push(block);
    }

    const eth1Provider: IEth1Provider = {
      deployBlock: 0,
      getBlockNumber: async () => 0,
      getBlockByNumber: async (blockNumber) => {
        // On each call simulate that the eth1 chain advances 1 block with +1 totalDifficulty
        if (blockNumber === "latest") {
          if (latestBlockPointer >= blocks.length) {
            throw Error("Fetched too many blocks");
          } else {
            return blocks[latestBlockPointer++];
          }
        }
        return blocks[blockNumber];
      },
      getBlockByHash: async (blockHashHex) => blocksByHash.get(blockHashHex) ?? null,
      getBlocksByNumber: async (): Promise<any> => {
        throw Error("Not implemented");
      },
      getDepositEvents: async (): Promise<any> => {
        throw Error("Not implemented");
      },
      validateContract: async (): Promise<any> => {
        throw Error("Not implemented");
      },
    };

    await runFindMergeBlockTest(eth1Provider, blocks[blocks.length - 1]);
  });

  it("Should find terminal pow block fetching past blocks", async () => {
    // Set current network totalDifficulty to behind terminalTotalDifficulty by 5.
    // Then on each call to getBlockByNumber("latest") increase totalDifficulty by 1.

    const numOfBlocks = 5;
    const difficulty = 1;
    const ttdOffset = 1 * difficulty;
    const hashOffset = 100;
    const blocks: EthJsonRpcBlockRaw[] = [];

    for (let i = 0; i < numOfBlocks * 2; i++) {
      const block: EthJsonRpcBlockRaw = {
        number: toHex(hashOffset + i),
        hash: toRootHex(hashOffset + i + 1),
        parentHash: toRootHex(hashOffset + i),
        // Latest block is under TTD, so past block search is stopped
        totalDifficulty: toHex(terminalTotalDifficulty + i * difficulty - ttdOffset),
        timestamp: "0x0",
      };
      blocks.push(block);
    }

    // Before last block (with ttdOffset = 1) is the merge block
    const expectedMergeBlock = blocks[ttdOffset];

    const eth1Provider = mockEth1ProviderFromBlocks(blocks);
    await runFindMergeBlockTest(eth1Provider, expectedMergeBlock);
  });

  it("Should find terminal pow block fetching past blocks till genesis", async () => {
    // There's no block with TD < TTD, searcher should stop at genesis block

    const numOfBlocks = 5;
    const difficulty = 1;
    const blocks: EthJsonRpcBlockRaw[] = [];

    for (let i = 0; i < numOfBlocks * 2; i++) {
      const block: EthJsonRpcBlockRaw = {
        number: toHex(i),
        hash: toRootHex(i + 1),
        parentHash: toRootHex(i),
        // Latest block is under TTD, so past block search is stopped
        totalDifficulty: toHex(terminalTotalDifficulty + i * difficulty + 1),
        timestamp: "0x0",
      };
      blocks.push(block);
    }

    // Merge block must be genesis block
    const expectedMergeBlock = blocks[0];

    const eth1Provider = mockEth1ProviderFromBlocks(blocks);
    await runFindMergeBlockTest(eth1Provider, expectedMergeBlock);
  });

  function mockEth1ProviderFromBlocks(blocks: EthJsonRpcBlockRaw[]): IEth1Provider {
    const blocksByHash = new Map<string, EthJsonRpcBlockRaw>();

    for (const block of blocks) {
      blocksByHash.set(block.hash, block);
    }

    return {
      deployBlock: 0,
      getBlockNumber: async () => 0,
      getBlockByNumber: async (blockNumber) => {
        // Always return the same block with totalDifficulty > TTD and unknown parent
        if (blockNumber === "latest") return blocks[blocks.length - 1];
        return blocks[blockNumber];
      },
      getBlockByHash: async (blockHashHex) => blocksByHash.get(blockHashHex) ?? null,
      getBlocksByNumber: async (from, to) => blocks.slice(from, to),
      getDepositEvents: async (): Promise<any> => {
        throw Error("Not implemented");
      },
      validateContract: async (): Promise<any> => {
        throw Error("Not implemented");
      },
    };
  }

  async function runFindMergeBlockTest(
    eth1Provider: IEth1Provider,
    expectedMergeBlock: EthJsonRpcBlockRaw
  ): Promise<void> {
    const eth1MergeBlockTracker = new Eth1MergeBlockTracker(
      {
        config,
        logger,
        signal: controller.signal,
        metrics: null,
      },
      eth1Provider as IEth1Provider
    );
    eth1MergeBlockTracker.startPollingMergeBlock();

    // Wait for Eth1MergeBlockTracker to find at least one merge block
    while (!controller.signal.aborted) {
      if (await eth1MergeBlockTracker.getTerminalPowBlock()) break;
      await sleep(10, controller.signal);
    }

    // Status should acknowlege merge block is found
    expect(eth1MergeBlockTracker["status"].code).to.equal(StatusCode.FOUND, "Wrong StatusCode");

    // Given the total difficulty offset the block that has TTD is the `difficultyOffset`nth block
    expect(await eth1MergeBlockTracker.getTerminalPowBlock()).to.deep.equal(
      toPowBlock(expectedMergeBlock),
      "Wrong found terminal pow block"
    );
  }
});

function toHex(num: number | bigint): string {
  return "0x" + num.toString(16);
}

function toRootHex(num: number): string {
  return "0x" + num.toString(16).padStart(64, "0");
}
