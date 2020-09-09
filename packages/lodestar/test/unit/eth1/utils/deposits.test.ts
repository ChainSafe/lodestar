import {expect} from "chai";
import {Root} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {verifyMerkleBranch} from "@chainsafe/lodestar-utils";
import {getDepositsWithProofs} from "../../../../src/eth1/utils/deposits";
import {IDepositLog} from "../../../../src/eth1/types";
import {generateDepositData} from "../../../utils/deposit";

describe("eth1 / util / deposits", function () {
  it("return empty array if no pending deposits", async function () {
    const initialValues = [Buffer.alloc(32)] as List<Root>;
    const depositRootTree = config.types.DepositDataRootList.tree.createValue(initialValues);
    const deposits = getDepositsWithProofs([], depositRootTree, 0);
    expect(deposits).to.be.deep.equal([]);
  });

  it("return deposits with valid proofs", async function () {
    const depositEvents = Array.from(
      {length: 2},
      (_, index): IDepositLog => ({
        depositData: generateDepositData(),
        blockNumber: index,
        index,
      })
    );

    const depositRootTree = config.types.DepositDataRootList.tree.defaultValue();
    for (const depositLog of depositEvents) {
      depositRootTree.push(config.types.DepositData.hashTreeRoot(depositLog.depositData));
    }

    const deposits = getDepositsWithProofs(depositEvents, depositRootTree, 1);

    const depositsRoot = depositRootTree.hashTreeRoot();
    expect(deposits.length).to.be.equal(2);
    deposits.forEach((deposit, index) => {
      expect(
        verifyMerkleBranch(
          config.types.DepositData.hashTreeRoot(deposit.data),
          Array.from(deposit.proof).map((p) => p.valueOf() as Uint8Array),
          33,
          index,
          depositsRoot.valueOf() as Uint8Array
        ),
        `Wrong merkle proof on deposit ${index}`
      ).to.be.true;
    });
  });
});
