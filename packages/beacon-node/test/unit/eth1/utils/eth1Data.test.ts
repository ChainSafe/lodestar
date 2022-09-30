import {expect} from "chai";
import pick from "lodash/pick.js";
import {Root, phase0, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {iteratorFromArray} from "../../../utils/interator.js";
import {
  getEth1DataForBlocks,
  getDepositsByBlockNumber,
  getDepositRootByDepositCount,
} from "../../../../src/eth1/utils/eth1Data.js";
import {Eth1Block} from "../../../../src/eth1/interface.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {Eth1ErrorCode} from "../../../../src/eth1/errors.js";
import {DepositTree} from "../../../../src/db/repositories/depositDataRoot.js";

describe("eth1 / util / getEth1DataForBlocks", function () {
  interface ITestCase {
    id: string;
    blocks: Eth1Block[];
    deposits: phase0.DepositEvent[];
    depositRootTree: DepositTree;
    lastProcessedDepositBlockNumber: number;
    expectedEth1Data?: Partial<phase0.Eth1Data & Eth1Block>[];
    error?: Eth1ErrorCode;
  }

  const testCases: (() => ITestCase)[] = [
    () => {
      // Result must contain all blocks from eth1Blocks, with backfilled eth1Data
      const expectedEth1Data = [
        {blockNumber: 5, depositCount: 13},
        {blockNumber: 6, depositCount: 13},
        {blockNumber: 7, depositCount: 17},
        {blockNumber: 8, depositCount: 17},
        {blockNumber: 9, depositCount: 17},
      ];

      // Consecutive block headers to be filled with eth1Data
      const blocks = expectedEth1Data.map(({blockNumber}) => getMockBlock({blockNumber}));

      // Arbitrary list of consecutive non-uniform (blockNumber-wise) deposit roots
      const deposits: phase0.DepositEvent[] = expectedEth1Data.map(({blockNumber, depositCount}) =>
        getMockDeposit({blockNumber, index: depositCount - 1})
      );
      const lastProcessedDepositBlockNumber = expectedEth1Data[expectedEth1Data.length - 1].blockNumber;

      // Pre-fill the depositTree with roots for all deposits
      const depositRootTree = ssz.phase0.DepositDataRootList.toViewDU(
        Array.from({length: deposits[deposits.length - 1].index + 1}, (_, i) => Buffer.alloc(32, i))
      );

      return {
        id: "Normal case",
        blocks,
        deposits,
        depositRootTree,
        lastProcessedDepositBlockNumber,
        expectedEth1Data,
      };
    },

    () => {
      return {
        id: "No deposits yet, should throw with NoDepositsForBlockRange",
        blocks: [getMockBlock({blockNumber: 0})],
        deposits: [],
        depositRootTree: ssz.phase0.DepositDataRootList.defaultViewDU(),
        lastProcessedDepositBlockNumber: 0,
        error: Eth1ErrorCode.NO_DEPOSITS_FOR_BLOCK_RANGE,
      };
    },

    () => {
      return {
        id: "With deposits and no deposit roots, should throw with NotEnoughDepositRoots",
        blocks: [getMockBlock({blockNumber: 0})],
        deposits: [getMockDeposit({blockNumber: 0, index: 0})],
        depositRootTree: ssz.phase0.DepositDataRootList.defaultViewDU(),
        lastProcessedDepositBlockNumber: 0,
        error: Eth1ErrorCode.NOT_ENOUGH_DEPOSIT_ROOTS,
      };
    },

    () => {
      return {
        id: "Empty case",
        blocks: [],
        deposits: [],
        depositRootTree: ssz.phase0.DepositDataRootList.defaultViewDU(),
        lastProcessedDepositBlockNumber: 0,
        expectedEth1Data: [],
      };
    },
  ];

  for (const testCase of testCases) {
    const {
      id,
      blocks,
      deposits,
      depositRootTree,
      lastProcessedDepositBlockNumber,
      expectedEth1Data,
      error,
    } = testCase();
    it(id, async function () {
      const eth1DatasPromise = getEth1DataForBlocks(
        blocks,
        // Simulate a descending stream reading from DB
        iteratorFromArray(deposits.reverse()),
        depositRootTree,
        lastProcessedDepositBlockNumber
      );

      if (expectedEth1Data) {
        const eth1Datas = await eth1DatasPromise;
        const eth1DatasPartial = eth1Datas.map((eth1Data) => pick(eth1Data, Object.keys(expectedEth1Data[0])));
        expect(eth1DatasPartial).to.deep.equal(expectedEth1Data);
      } else if (error) {
        await expectRejectedWithLodestarError(eth1DatasPromise, error);
      } else {
        throw Error("Test case must have 'expectedEth1Data' or 'error'");
      }
    });
  }
});

describe("eth1 / util / getDepositsByBlockNumber", function () {
  interface ITestCase {
    id: string;
    fromBlock: number;
    toBlock: number;
    deposits: phase0.DepositEvent[];
    expectedResult: phase0.DepositEvent[];
  }

  const testCases: (() => ITestCase)[] = [
    () => {
      const deposit0 = getMockDeposit({blockNumber: 0, index: 0});
      return {
        id: "Collect deposit at block 0 in range [1,2]",
        fromBlock: 1,
        toBlock: 2,
        deposits: [deposit0],
        expectedResult: [deposit0],
      };
    },
    () => {
      const deposit1 = getMockDeposit({blockNumber: 1, index: 0});
      return {
        id: "Collect deposit at block 1 in range [1,2]",
        fromBlock: 1,
        toBlock: 2,
        deposits: [deposit1],
        expectedResult: [deposit1],
      };
    },
    () => {
      const deposit3 = getMockDeposit({blockNumber: 3, index: 0});
      return {
        id: "Don't collect deposit at block 3 in range [1,2]",
        fromBlock: 1,
        toBlock: 2,
        deposits: [deposit3],
        expectedResult: [],
      };
    },
    () => {
      const deposit0 = getMockDeposit({blockNumber: 0, index: 0});
      const deposit3 = getMockDeposit({blockNumber: 3, index: 4});
      return {
        id: "Collect multiple deposits",
        fromBlock: 1,
        toBlock: 4,
        deposits: [deposit0, deposit3],
        expectedResult: [deposit0, deposit3],
      };
    },
    () => {
      return {
        id: "Empty case",
        fromBlock: 0,
        toBlock: 0,
        deposits: [],
        expectedResult: [],
      };
    },
  ];

  for (const testCase of testCases) {
    const {id, fromBlock, toBlock, deposits, expectedResult} = testCase();
    it(id, async function () {
      const result = await getDepositsByBlockNumber(
        fromBlock,
        toBlock, // Simulate a descending stream reading from DB
        iteratorFromArray(deposits.reverse())
      );
      expect(result).to.deep.equal(expectedResult);
    });
  }
});

describe("eth1 / util / getDepositRootByDepositCount", function () {
  interface ITestCase {
    id: string;
    depositCounts: number[];
    depositRootTree: DepositTree;
    expectedMap: Map<number, Root>;
  }

  const fullRootMap = new Map<number, Root>();
  const fullDepositRootTree = ssz.phase0.DepositDataRootList.defaultViewDU();
  for (let i = 0; i < 10; i++) {
    fullDepositRootTree.push(Buffer.alloc(32, i));
    fullRootMap.set(fullDepositRootTree.length, fullDepositRootTree.hashTreeRoot());
  }

  const testCases: (() => ITestCase)[] = [
    () => {
      return {
        id: "Roots are computed correctly, all values match",
        depositCounts: Array.from(fullRootMap.keys()),
        depositRootTree: fullDepositRootTree,
        expectedMap: fullRootMap,
      };
    },
    () => {
      const depositCounts = Array.from(fullRootMap.keys()).filter((n) => n % 2);
      const expectedMap = new Map<number, Root>();
      for (const depositCount of depositCounts) {
        const depositRoot = fullRootMap.get(depositCount);
        if (depositRoot) expectedMap.set(depositCount, depositRoot);
      }
      return {
        id: "Roots are computed correctly, sparse values match",
        depositCounts,
        depositRootTree: fullDepositRootTree,
        expectedMap,
      };
    },
    () => {
      const emptyTree = ssz.phase0.DepositDataRootList.defaultViewDU();
      return {
        id: "Empty case",
        depositCounts: [],
        depositRootTree: emptyTree,
        expectedMap: new Map<number, Root>(),
      };
    },
  ];

  for (const testCase of testCases) {
    const {id, depositCounts, depositRootTree, expectedMap} = testCase();
    it(id, function () {
      const map = getDepositRootByDepositCount(depositCounts, depositRootTree);
      expect(renderDepositRootByDepositCount(map)).to.deep.equal(renderDepositRootByDepositCount(expectedMap));
    });
  }
});

function renderDepositRootByDepositCount(map: Map<number, Uint8Array>): Record<string, string> {
  const data: Record<string, string> = {};
  for (const [key, root] of Object.entries(map)) {
    data[key] = toHex(root);
  }
  return data;
}

function getMockBlock({blockNumber}: {blockNumber: number}): Eth1Block {
  return {
    blockNumber,
    blockHash: Buffer.alloc(32, blockNumber),
    timestamp: blockNumber,
  };
}

function getMockDeposit({blockNumber, index}: {blockNumber: number; index: number}): phase0.DepositEvent {
  return {
    blockNumber,
    index,
    depositData: {} as phase0.DepositData, // Not used
  };
}
