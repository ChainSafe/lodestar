import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Root} from "@chainsafe/lodestar-types";
import {List, toHexString} from "@chainsafe/ssz";
import {
  getEth1DataDepositFromDeposits,
  fillEth1DataDepositToBlockRange,
  IEth1DataDeposit,
} from "../../../../src/eth1/utils/eth1DataDeposit";

describe("eth1 / util / getEth1DataDepositFromLogs", function () {
  it("should return eth1 data (depositRoot, depositCount) for block-spaced logs", () => {
    // Arbitrary list of consecutive non-uniform (blockNumber-wise) deposit roots
    const depositRoots: {index: number; root: Uint8Array; blockNumber: number}[] = [
      {index: 10, blockNumber: 5},
      {index: 11, blockNumber: 5},
      {index: 12, blockNumber: 5},
      {index: 13, blockNumber: 46},
      {index: 14, blockNumber: 46},
      {index: 15, blockNumber: 60},
      {index: 16, blockNumber: 60},
      {index: 17, blockNumber: 83},
      {index: 18, blockNumber: 83},
      {index: 19, blockNumber: 99},
    ].map(({index, blockNumber}) => ({index, blockNumber, root: new Uint8Array(Array(32).fill(index))}));

    // Create an existing deposit tree with more deposits than the earliest item in `depositRoots`
    const existingTreeLength = depositRoots[0].index;
    const values = Array.from({length: existingTreeLength}, (_, i) => Buffer.alloc(32, String(i))) as List<Root>;
    const depositRootTree = config.types.DepositDataRootList.tree.createValue(values);

    const eth1DataDeposits = getEth1DataDepositFromDeposits(depositRoots, depositRootTree);
    // Convert to hex to ease result checking
    const eth1DataDepositsHex = eth1DataDeposits.map((eth1DataDeposit) => ({
      ...eth1DataDeposit,
      depositRoot: toHexString(eth1DataDeposit.depositRoot),
    }));

    expect(eth1DataDepositsHex).to.deep.equal([
      {
        blockNumber: 5,
        depositRoot: "0xcab74cd3e62f92390eed488aa198cbf2b0d53e4900413ebcdb23ea0f8e66aa12",
        depositCount: 13,
      },
      {
        blockNumber: 46,
        depositRoot: "0x372b399ae4b7855549e0c71de92a95e28445e14e746bc5c1bae724d1e22e0383",
        depositCount: 15,
      },
      {
        blockNumber: 60,
        depositRoot: "0xa7a09ed38e1d7b865dc9ba09ee9cdd56660ecbb2361e512b33b3f91ac7935d73",
        depositCount: 17,
      },
      {
        blockNumber: 83,
        depositRoot: "0xf35238eaf9983fb5ed38fd48d8ea132d6e8f1df328f3d4247ebd2e1b0cbd82bc",
        depositCount: 19,
      },
      {
        blockNumber: 99,
        depositRoot: "0x8918169e9186c2eafee39da6ca5caa8423a299068f956c86b35f98d2ec9a1c1b",
        depositCount: 20,
      },
    ]);
  });
});

describe("eth1 / util / fillEth1DataDepositToBlockRange", function () {
  // Arbitrary list of consecutive non-uniform (blockNumber-wise) deposit roots
  const eth1DataDepositArr: IEth1DataDeposit[] = [
    {blockNumber: 0, depositCount: 13},
    {blockNumber: 3, depositCount: 15},
    {blockNumber: 4, depositCount: 17},
    {blockNumber: 7, depositCount: 19},
    {blockNumber: 9, depositCount: 20},
  ].map(({blockNumber, depositCount}) => ({
    blockNumber,
    depositCount,
    depositRoot: new Uint8Array(Array(32).fill(blockNumber)),
  }));

  const testCases: {
    id: string;
    fromBlock: number;
    toBlock: number;
    expectedResult: {blockNumber: number; depositCount: number}[];
  }[] = [
    {
      id: "sequential eth1DataDeposit items - full array",
      fromBlock: 0,
      toBlock: 9,
      expectedResult: [
        {blockNumber: 0, depositCount: 13},
        {blockNumber: 1, depositCount: 13},
        {blockNumber: 2, depositCount: 13},
        {blockNumber: 3, depositCount: 15},
        {blockNumber: 4, depositCount: 17},
        {blockNumber: 5, depositCount: 17},
        {blockNumber: 6, depositCount: 17},
        {blockNumber: 7, depositCount: 19},
        {blockNumber: 8, depositCount: 19},
        {blockNumber: 9, depositCount: 20},
      ],
    },
    {
      id: "sequential eth1DataDeposit items - small array",
      fromBlock: 3,
      toBlock: 4,
      expectedResult: [
        {blockNumber: 3, depositCount: 15},
        {blockNumber: 4, depositCount: 17},
      ],
    },
    {
      id: "sequential eth1DataDeposit items - future block",
      fromBlock: 9,
      toBlock: 11,
      expectedResult: [
        {blockNumber: 9, depositCount: 20},
        {blockNumber: 10, depositCount: 20},
        {blockNumber: 11, depositCount: 20},
      ],
    },
  ];

  for (const {id, fromBlock, toBlock, expectedResult} of testCases) {
    it(id, () => {
      const eth1DataDepositArrSeq = fillEth1DataDepositToBlockRange(fromBlock, toBlock, eth1DataDepositArr);

      expect(
        eth1DataDepositArrSeq.map((eth1DataDeposit) => ({
          blockNumber: eth1DataDeposit.blockNumber,
          depositCount: eth1DataDeposit.depositCount,
        }))
      ).to.deep.equal(expectedResult);
    });
  }
});
