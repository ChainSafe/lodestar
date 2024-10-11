import {describe, it, expect} from "vitest";
import {phase0, ssz} from "@lodestar/types";
import {MAX_DEPOSITS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {verifyMerkleBranch} from "@lodestar/utils";
import {createChainForkConfig} from "@lodestar/config";
import {filterBy} from "../../../utils/db.js";
import {Eth1ErrorCode} from "../../../../src/eth1/errors.js";
import {generateState} from "../../../utils/state.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {getDeposits, getDepositsWithProofs, DepositGetter} from "../../../../src/eth1/utils/deposits.js";
import {DepositTree} from "../../../../src/db/repositories/depositDataRoot.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";

describe("eth1 / util / deposits", function () {
  describe("getDeposits", () => {
    type TestCase = {
      id: string;
      depositCount: number;
      eth1DepositIndex: number;
      depositIndexes: number[];
      expectedReturnedIndexes?: number[];
      error?: Eth1ErrorCode;
      postElectra?: boolean;
    };

    const testCases: TestCase[] = [
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
      {
        id: "No deposits to be included post Electra after deposit_requests_start_index",
        depositCount: 2030,
        eth1DepositIndex: 2025,
        depositIndexes: Array.from({length: 2030}, (_, i) => i),
        expectedReturnedIndexes: [],
        postElectra: true,
      },
      {
        id: "Should return deposits post Electra before deposit_requests_start_index",
        depositCount: 2022,
        eth1DepositIndex: 2018,
        depositIndexes: Array.from({length: 2022}, (_, i) => i),
        expectedReturnedIndexes: [2018, 2019, 2020, 2021],
        postElectra: true,
      },
      {
        id: "Should return deposits less than MAX_DEPOSITS post Electra before deposit_requests_start_index",
        depositCount: 10 * MAX_DEPOSITS,
        eth1DepositIndex: 0,
        depositIndexes: Array.from({length: 10 * MAX_DEPOSITS}, (_, i) => i),
        expectedReturnedIndexes: Array.from({length: MAX_DEPOSITS}, (_, i) => i),
        postElectra: true,
      },
    ];

    const postElectraConfig = createChainForkConfig({
      ALTAIR_FORK_EPOCH: 1,
      BELLATRIX_FORK_EPOCH: 2,
      CAPELLA_FORK_EPOCH: 3,
      DENEB_FORK_EPOCH: 4,
      ELECTRA_FORK_EPOCH: 5,
    });
    const postElectraSlot = postElectraConfig.ELECTRA_FORK_EPOCH * SLOTS_PER_EPOCH + 1;

    for (const testCase of testCases) {
      const {id, depositIndexes, eth1DepositIndex, depositCount, expectedReturnedIndexes, error, postElectra} =
        testCase;
      it(id, async function () {
        const state = postElectra
          ? generateState({slot: postElectraSlot, eth1DepositIndex}, postElectraConfig)
          : generateState({eth1DepositIndex});
        const cachedState = createCachedBeaconStateTest(
          state,
          postElectra ? postElectraConfig : createChainForkConfig({})
        );
        const eth1Data = generateEth1Data(depositCount);
        const deposits = depositIndexes.map((index) => generateDepositEvent(index));
        const depositsGetter: DepositGetter<phase0.DepositEvent> = async (indexRange) =>
          filterBy(deposits, indexRange, (deposit) => deposit.index);

        const resultPromise = getDeposits(cachedState, eth1Data, depositsGetter);

        if (expectedReturnedIndexes) {
          const result = await resultPromise;
          expect(result.map((deposit) => deposit.index)).toEqual(expectedReturnedIndexes);
        } else if (error != null) {
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
      expect(deposits).toEqual([]);
    });

    it("return deposits with valid proofs", function () {
      const depositEvents = Array.from(
        {length: 2},
        (_, index): phase0.DepositEvent => ({
          depositData: ssz.phase0.DepositData.defaultValue(),
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
      expect(deposits.length).toBe(2);

      // Verify each individual merkle root
      for (const [index, deposit] of deposits.entries()) {
        // Wrong merkle proof on deposit ${index}
        expect(
          verifyMerkleBranch(
            ssz.phase0.DepositData.hashTreeRoot(deposit.data),
            Array.from(deposit.proof).map((p) => p),
            33,
            index,
            eth1Data.depositRoot
          )
        ).toBe(true);
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

function generateDepositEvent(index: number, blockNumber = 0): phase0.DepositEvent {
  const depositData = ssz.phase0.DepositData.defaultValue();
  depositData.amount = 32 * 10 * 9;

  return {
    index,
    blockNumber,
    depositData,
  };
}
