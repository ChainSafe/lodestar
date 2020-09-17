import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {pick} from "lodash";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Root, Eth1Data, DepositEvent, Eth1Block} from "@chainsafe/lodestar-types";
import {List, TreeBacked} from "@chainsafe/ssz";
import {iteratorFromArray} from "../../../utils/interator";
import {mapToObj} from "../../../utils/map";
import {
  getEth1DataForBlocks,
  getDepositCountByBlockNumber,
  getDepositRootByDepositCount,
  ErrorNoDeposits,
  ErrorNotEnoughDepositRoots,
} from "../../../../src/eth1/utils/eth1Data";

chai.use(chaiAsPromised);

describe("eth1 / util / getEth1DataForBlocks", function () {
  interface ITestCase {
    id: string;
    blocks: Eth1Block[];
    deposits: DepositEvent[];
    depositRootTree: TreeBacked<List<Root>>;
    lastProcessedDepositBlockNumber: number;
    expectedEth1Data?: Partial<Eth1Data & Eth1Block>[];
    error?: any;
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
      const deposits: DepositEvent[] = expectedEth1Data.map(({blockNumber, depositCount}) =>
        getMockDeposit({blockNumber, index: depositCount - 1})
      );
      const lastProcessedDepositBlockNumber = expectedEth1Data[expectedEth1Data.length - 1].blockNumber;

      // Pre-fill the depositTree with roots for all deposits
      const depositRootTree = config.types.DepositDataRootList.tree.createValue(
        Array.from({length: deposits[deposits.length - 1].index + 1}, (_, i) => Buffer.alloc(32, i)) as List<Root>
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
        id: "No deposits yet, should throw with NoDeposits",
        blocks: [getMockBlock({blockNumber: 0})],
        deposits: [],
        depositRootTree: config.types.DepositDataRootList.tree.defaultValue(),
        lastProcessedDepositBlockNumber: 0,
        error: ErrorNoDeposits,
      };
    },

    () => {
      return {
        id: "With deposits and no deposit roots, should throw with NotEnoughDepositRoots",
        blocks: [getMockBlock({blockNumber: 0})],
        deposits: [getMockDeposit({blockNumber: 0, index: 0})],
        depositRootTree: config.types.DepositDataRootList.tree.defaultValue(),
        lastProcessedDepositBlockNumber: 0,
        error: ErrorNotEnoughDepositRoots,
      };
    },

    () => {
      return {
        id: "Empty case",
        blocks: [],
        deposits: [],
        depositRootTree: config.types.DepositDataRootList.tree.defaultValue(),
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
        await expect(eth1DatasPromise).to.be.rejectedWith(error);
      } else {
        throw Error("Test case must have 'expectedEth1Data' or 'error'");
      }
    });
  }
});

describe("eth1 / util / getDepositCountByBlockNumber", function () {
  interface ITestCase {
    id: string;
    fromBlock: number;
    toBlock: number;
    deposits: DepositEvent[];
    expectedMap: Map<number, number>;
  }

  const testCases: ITestCase[] = [
    {
      id: "Map deposit at block 0 => 0,1,2 in range [1,2]",
      fromBlock: 1,
      toBlock: 2,
      deposits: [getMockDeposit({blockNumber: 0, index: 0})],
      expectedMap: new Map([
        [0, 1],
        [1, 1],
        [2, 1],
      ]),
    },
    {
      id: "Map deposit at block 1 => 1,2 in range [1,2]",
      fromBlock: 1,
      toBlock: 2,
      deposits: [getMockDeposit({blockNumber: 1, index: 0})],
      expectedMap: new Map([
        [1, 1],
        [2, 1],
      ]),
    },
    {
      id: "Map deposit at block 2 => 2 in range [1,2]",
      fromBlock: 1,
      toBlock: 2,
      deposits: [getMockDeposit({blockNumber: 2, index: 0})],
      expectedMap: new Map([[2, 1]]),
    },
    {
      id: "Map deposit at block 3 => [] in range [1,2]",
      fromBlock: 1,
      toBlock: 2,
      deposits: [getMockDeposit({blockNumber: 3, index: 0})],
      expectedMap: new Map(),
    },
    {
      id: "Map multiple deposits",
      fromBlock: 1,
      toBlock: 4,
      deposits: [getMockDeposit({blockNumber: 0, index: 0}), getMockDeposit({blockNumber: 3, index: 4})],
      expectedMap: new Map([
        [0, 1],
        [1, 1],
        [2, 1],
        [3, 5],
        [4, 5],
      ]),
    },
    {
      id: "Empty case",
      fromBlock: 0,
      toBlock: 0,
      deposits: [],
      expectedMap: new Map([]),
    },
  ];

  for (const {id, fromBlock, toBlock, deposits, expectedMap} of testCases) {
    it(id, async function () {
      const map = await getDepositCountByBlockNumber(
        fromBlock,
        toBlock, // Simulate a descending stream reading from DB
        iteratorFromArray(deposits.reverse())
      );
      expect(mapToObj(map)).to.deep.equal(mapToObj(expectedMap));
    });
  }
});

describe("eth1 / util / getDepositRootByDepositCount", function () {
  interface ITestCase {
    id: string;
    depositCounts: number[];
    depositRootTree: TreeBacked<List<Root>>;
    expectedMap: Map<number, Root>;
  }

  const fullRootMap = new Map<number, Root>();
  const fullDepositRootTree = config.types.DepositDataRootList.tree.defaultValue();
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
      const emptyTree = config.types.DepositDataRootList.tree.defaultValue();
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
    it(id, async function () {
      const map = await getDepositRootByDepositCount(depositCounts, depositRootTree);
      expect(mapToObj(map)).to.deep.equal(mapToObj(expectedMap));
    });
  }
});

function getMockBlock({blockNumber}: {blockNumber: number}): Eth1Block {
  return {
    blockNumber,
    blockHash: Buffer.alloc(32, blockNumber),
    timestamp: blockNumber,
  };
}

function getMockDeposit({blockNumber, index}: {blockNumber: number; index: number}): DepositEvent {
  return {
    blockNumber,
    index,
    depositData: {} as any, // Not used
  };
}
