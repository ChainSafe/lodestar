import {expect} from "chai";
import {groupDepositEventsByBlock, optimizeNextBlockDiffForGenesis} from "../../../../src/eth1/impl/util";
import {IDepositEvent, IEth1Block} from "../../../../src/eth1";

describe("utils of eth1", function () {
  it("should return deposit events by block sorted by index", () => {
    const depositData = {
      amount: BigInt(0),
      signature: Buffer.alloc(96),
      withdrawalCredentials: Buffer.alloc(32),
      pubkey: Buffer.alloc(48),
    };
    const depositEvents: IDepositEvent[] = [
      {blockNumber: 1, index: 0, ...depositData},
      {blockNumber: 2, index: 2, ...depositData},
      {blockNumber: 2, index: 1, ...depositData},
      {blockNumber: 3, index: 4, ...depositData},
      {blockNumber: 3, index: 3, ...depositData},
    ];
    const blockEvents = groupDepositEventsByBlock(depositEvents);

    // Keep only the relevant info of the result
    const blockEventsIndexOnly = blockEvents.map((blockEvent) => ({
      blockNumber: blockEvent.blockNumber,
      deposits: blockEvent.depositEvents.map((deposit) => deposit.index),
    }));

    expect(blockEventsIndexOnly).to.deep.equal([
      {blockNumber: 1, deposits: [0]},
      {blockNumber: 2, deposits: [1, 2]},
      {blockNumber: 3, deposits: [3, 4]},
    ]);
  });

  it("should return optimized block diff to find genesis time", () => {
    const params = {
      MIN_GENESIS_TIME: 1578009600,
      GENESIS_DELAY: 172800,
      SECONDS_PER_ETH1_BLOCK: 14,
    };
    const initialTimeDiff = params.GENESIS_DELAY * 2;
    let lastFetchedBlock: IEth1Block = {
      hash: "0x",
      timestamp: params.MIN_GENESIS_TIME - initialTimeDiff,
      number: 100000,
    };

    const diffRecord: {blockDiff: number; number: number}[] = [];
    for (let i = 0; i < 100; i++) {
      const blockDiff = optimizeNextBlockDiffForGenesis(lastFetchedBlock, params);

      // Simulate fetching the next block
      lastFetchedBlock = {
        hash: "0x",
        timestamp: lastFetchedBlock.timestamp + blockDiff * params.SECONDS_PER_ETH1_BLOCK,
        number: lastFetchedBlock.number + blockDiff,
      };

      if (lastFetchedBlock.timestamp > params.MIN_GENESIS_TIME - params.GENESIS_DELAY) {
        break;
      } else {
        diffRecord.push({number: lastFetchedBlock.number, blockDiff});
      }
    }

    // Make sure the returned diffs converge to genesis time fast
    expect(diffRecord).to.deep.equal([
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
