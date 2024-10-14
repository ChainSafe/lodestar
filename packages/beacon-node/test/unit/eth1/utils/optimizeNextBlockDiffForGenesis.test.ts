import {describe, it, expect} from "vitest";
import {optimizeNextBlockDiffForGenesis} from "../../../../src/eth1/utils/optimizeNextBlockDiffForGenesis.js";
import {Eth1Block} from "../../../../src/eth1/interface.js";

describe("eth1 / utils / optimizeNextBlockDiffForGenesis", () => {
  it("should return optimized block diff to find genesis time", () => {
    const params = {
      MIN_GENESIS_TIME: 1578009600,
      GENESIS_DELAY: 172800,
      SECONDS_PER_ETH1_BLOCK: 14,
    };
    const initialTimeDiff = params.GENESIS_DELAY * 2;
    let lastFetchedBlock: Eth1Block = {
      blockHash: Buffer.alloc(32, 0),
      blockNumber: 100000,
      timestamp: params.MIN_GENESIS_TIME - initialTimeDiff,
    };

    const diffRecord: {blockDiff: number; number: number}[] = [];
    for (let i = 0; i < 100; i++) {
      const blockDiff = optimizeNextBlockDiffForGenesis(lastFetchedBlock, params);

      // Simulate fetching the next block
      lastFetchedBlock = {
        blockHash: Buffer.alloc(32, 0),
        blockNumber: lastFetchedBlock.blockNumber + blockDiff,
        timestamp: lastFetchedBlock.timestamp + blockDiff * params.SECONDS_PER_ETH1_BLOCK,
      };

      if (lastFetchedBlock.timestamp > params.MIN_GENESIS_TIME - params.GENESIS_DELAY) {
        break;
      }
      diffRecord.push({number: lastFetchedBlock.blockNumber, blockDiff});
    }

    // Make sure the returned diffs converge to genesis time fast
    expect(diffRecord).toEqual([
      {number: 106171, blockDiff: 6171},
      {number: 109256, blockDiff: 3085},
      {number: 110799, blockDiff: 1543},
      {number: 111570, blockDiff: 771},
      {number: 111956, blockDiff: 386},
      {number: 112149, blockDiff: 193},
      {number: 112245, blockDiff: 96},
      {number: 112293, blockDiff: 48},
      {number: 112317, blockDiff: 24},
      {number: 112329, blockDiff: 12},
      {number: 112335, blockDiff: 6},
      {number: 112338, blockDiff: 3},
      {number: 112340, blockDiff: 2},
      {number: 112341, blockDiff: 1},
      {number: 112342, blockDiff: 1},
    ]);
  });
});
