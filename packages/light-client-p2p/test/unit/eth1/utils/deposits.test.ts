import {expect} from "chai";
import {phase0, ssz} from "@lodestar/types";
import {MAX_DEPOSITS} from "@lodestar/params";
import {verifyMerkleBranch} from "@lodestar/utils";
import {filterBy} from "../../../utils/db.js";
import {Eth1ErrorCode} from "../../../../src/eth1/errors.js";
import {generateDepositData, generateDepositEvent} from "../../../utils/deposit.js";
import {generateState} from "../../../utils/state.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {getDeposits, getDepositsWithProofs, DepositGetter} from "../../../../src/eth1/utils/deposits.js";
import {DepositTree} from "../../../../src/db/repositories/depositDataRoot.js";

describe("eth1 / util / deposits", function () {
  describe("getDeposits", () => {
    interface ITestCase {
      id: string;
      depositCount: number;
      eth1DepositIndex: number;
      depositIndexes: number[];
      expectedReturnedIndexes?: number[];
      error?: Eth1ErrorCode;
    }

    const testCases: ITestCase[] = [
      {
        id: "Return first deposit",
        depositCount: 1,
        eth1DepositIndex: 0,
        depositIndexes: [0, 1, 2, 3],
        expectedReturnedIndexes: [0],
      },
      {
        id: "Return second and third deposit",
        depositCount: 3,
        eth1DepositIndex: 1,
        depositIndexes: [0, 1, 2, 3],
        expectedReturnedIndexes: [1, 2],
      },
      {
        id: "No deposits to be included",
        depositCount: 3,
        eth1DepositIndex: 3,
        depositIndexes: [0, 1, 2, 3],
        expectedReturnedIndexes: [],
      },
      {
        id: "Limit deposits to MAX_DEPOSITS",
        depositCount: 10 * MAX_DEPOSITS,
        eth1DepositIndex: 0,
        depositIndexes: Array.from({length: 10 * MAX_DEPOSITS}, (_, i) => i),
        expectedReturnedIndexes: Array.from({length: MAX_DEPOSITS}, (_, i) => i),
      },
      {
        id: "Should throw if depositIndex > depositCount",
        depositCount: 0,
        eth1DepositIndex: 1,
        depositIndexes: [],
        error: Eth1ErrorCode.DEPOSIT_INDEX_TOO_HIGH,
      },
      {
        id: "Should throw if DB returns less deposits than expected",
        depositCount: 1,
        eth1DepositIndex: 0,
        depositIndexes: [],
        error: Eth1ErrorCode.NOT_ENOUGH_DEPOSITS,
      },
      {
        id: "Empty case",
        depositCount: 0,
        eth1DepositIndex: 0,
        depositIndexes: [],
        expectedReturnedIndexes: [],
      },
    ];

    for (const testCase of testCases) {
      const {id, depositIndexes, eth1DepositIndex, depositCount, expectedReturnedIndexes, error} = testCase;
      it(id, async function () {
        const state = generateState({eth1DepositIndex});
        const eth1Data = generateEth1Data(depositCount);
        const deposits = depositIndexes.map((index) => generateDepositEvent(index));
        const depositsGetter: DepositGetter<phase0.DepositEvent> = async (indexRange) =>
          filterBy(deposits, indexRange, (deposit) => deposit.index);

        const resultPromise = getDeposits(state, eth1Data, depositsGetter);

        if (expectedReturnedIndexes) {
          const result = await resultPromise;
          expect(result.map((deposit) => deposit.index)).to.deep.equal(expectedReturnedIndexes);
        } else if (error) {
          await expectRejectedWithLodestarError(resultPromise, error);
        } else {
          throw Error("Test case must have 'result' or 'error'");
        }
      });
    }
  });

  describe("getDepositsWithProofs", () => {
    it("return empty array if no pending deposits", function () {
      const initialValues = [Buffer.alloc(32)];
      const depositRootTree = ssz.phase0.DepositDataRootList.toViewDU(initialValues);
      const depositCount = 0;
      const eth1Data = generateEth1Data(depositCount, depositRootTree);

      const deposits = getDepositsWithProofs([], depositRootTree, eth1Data);
      expect(deposits).to.be.deep.equal([]);
    });

    it("return deposits with valid proofs", function () {
      const depositEvents = Array.from(
        {length: 2},
        (_, index): phase0.DepositEvent => ({
          depositData: generateDepositData(),
          blockNumber: index,
          index,
        })
      );

      const depositRootTree = ssz.phase0.DepositDataRootList.defaultViewDU();
      for (const depositEvent of depositEvents) {
        depositRootTree.push(ssz.phase0.DepositData.hashTreeRoot(depositEvent.depositData));
      }
      const depositCount = depositEvents.length;
      const eth1Data = generateEth1Data(depositCount, depositRootTree);

      const deposits = getDepositsWithProofs(depositEvents, depositRootTree, eth1Data);

      // Should not return all deposits
      expect(deposits.length).to.be.equal(2);

      // Verify each individual merkle root
      for (const [index, deposit] of deposits.entries()) {
        expect(
          verifyMerkleBranch(
            ssz.phase0.DepositData.hashTreeRoot(deposit.data),
            Array.from(deposit.proof).map((p) => p),
            33,
            index,
            eth1Data.depositRoot
          ),
          `Wrong merkle proof on deposit ${index}`
        ).to.equal(true);
      }
    });
  });
});

function generateEth1Data(depositCount: number, depositRootTree?: DepositTree): phase0.Eth1Data {
  return {
    blockHash: Buffer.alloc(32),
    depositRoot: depositRootTree ? depositRootTree.sliceTo(depositCount - 1).hashTreeRoot() : Buffer.alloc(32),
    depositCount,
  };
}
