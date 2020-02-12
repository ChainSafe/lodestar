import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {ZERO_HASH} from "../../../../../src/constants";
import {OpPool} from "../../../../../src/opPool";
import {generateDeposits} from "../../../../../src/chain/factory/block/deposits";
import {generateState} from "../../../../utils/state";
import {generateDeposit, generateDepositData} from "../../../../utils/deposit";
import {DepositDataOperations} from "../../../../../src/opPool/modules";
import {verifyMerkleBranch} from "@chainsafe/eth2.0-utils";

describe("blockAssembly - deposits", function() {

  const sandbox = sinon.createSandbox();

  let opPool;

  beforeEach(() => {
    opPool = sandbox.createStubInstance(OpPool);
    opPool.depositData = sandbox.createStubInstance(DepositDataOperations);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("return empty array if no pending deposits", async function() {
    const result = await generateDeposits(
      config,
      opPool,
      generateState({
        eth1DepositIndex: 1,
      }),
      {
        depositCount: 1,
        blockHash: ZERO_HASH,
        depositRoot: ZERO_HASH
      },
      config.types.DepositDataRootList.tree.defaultValue()
    );
    expect(result).to.be.deep.equal([]);
  });

  it("return deposits with valid proofs", async function() {
    const deposits = [generateDepositData(), generateDepositData()];
    opPool.depositData.getAllBetween.resolves(deposits);
    const depositDataRootList = config.types.DepositDataRootList.tree.defaultValue();
    const tree = depositDataRootList.tree();

    depositDataRootList.push(...deposits.map((d) => config.types.DepositData.hashTreeRoot(d)));

    const eth1 = {
      depositCount: 2,
      blockHash: ZERO_HASH,
      depositRoot: tree.root
    };
    const result = await generateDeposits(
      config,
      opPool,
      generateState({
        eth1DepositIndex: 0,
      }),
      eth1,
      config.types.DepositDataRootList.tree.defaultValue(),
    );
    expect(result.length).to.be.equal(2);
    result.forEach((deposit, index) => {
      expect(
        verifyMerkleBranch(
          config.types.DepositData.hashTreeRoot(deposit.data),
          Array.from(deposit.proof).map((p) => p.valueOf() as Uint8Array),
          33,
          index,
          eth1.depositRoot.valueOf() as Uint8Array
        )
      ).to.be.true;
    });
  });
});
