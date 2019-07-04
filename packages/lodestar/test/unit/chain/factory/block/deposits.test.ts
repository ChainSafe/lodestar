import sinon from "sinon";
import {OpPool} from "../../../../../opPool";
import {generateDeposits} from "../../../../../chain/factory/block/deposits";
import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import {ProgressiveMerkleTree, verifyMerkleBranch} from "../../../../../util/merkleTree";
import {ZERO_HASH} from "../../../../../constants";
import {generateDeposit} from "../../../../utils/deposit";
import {hashTreeRoot} from "@chainsafe/ssz";
import {Deposit, DepositData} from "../../../../../../types";

describe('blockAssembly - deposits', function() {

  const sandbox = sinon.createSandbox();

  let opPool;

  beforeEach(() => {
    opPool = sandbox.createStubInstance(OpPool);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('return empty array if no pending deposits', async function() {
    const result = await generateDeposits(
      opPool,
      generateState({
        depositIndex: 1,
      }),
      {
        depositCount: 1,
        blockHash: ZERO_HASH,
        depositRoot: ZERO_HASH
      },
      ProgressiveMerkleTree.empty(4));
    expect(result).to.be.deep.equal([]);
  });

  it('return deposits with valid proofs', async function() {
    const deposits = [generateDeposit(), generateDeposit()];
    opPool.getDeposits.resolves(deposits);
    const tree = ProgressiveMerkleTree.empty(4);
    deposits.forEach((d, index) => {
      tree.add(index, hashTreeRoot(d.data, DepositData));
    });
    const eth1 = {
      depositCount: 2,
      blockHash: ZERO_HASH,
      depositRoot: tree.root()
    };
    const result = await generateDeposits(
      opPool,
      generateState({
        depositIndex: 0,
      }),
      eth1,
      tree
    );
    expect(result.length).to.be.equal(2);
    result.forEach((deposit, index) => {
      expect(
        verifyMerkleBranch(
          hashTreeRoot(deposit.data, DepositData),
          deposit.proof,
          4,
          index,
          eth1.depositRoot
        )
      ).to.be.true;
    });
  });

});
