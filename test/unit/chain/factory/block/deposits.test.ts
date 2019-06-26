import sinon from "sinon";
import {OpPool} from "../../../../../src/opPool";
import {generateDeposits} from "../../../../../src/chain/factory/block/deposits";
import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import {ProgressiveMerkleTree, verifyMerkleBranch} from "../../../../../src/util/merkleTree";
import {ZERO_HASH} from "../../../../../src/constants";
import {generateDeposit} from "../../../../utils/deposit";
import {hashTreeRoot} from "@chainsafe/ssz";
import {Deposit, DepositData} from "../../../../../src/types";

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
    const deposits = [generateDeposit(0), generateDeposit(1)];
    opPool.getDeposits.resolves(deposits);
    const tree = ProgressiveMerkleTree.empty(4);
    deposits.forEach((d) => {
      tree.add(d.index, hashTreeRoot(d.data, DepositData));
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
    result.forEach((deposit) => {
      expect(
        verifyMerkleBranch(
          hashTreeRoot(deposit.data, DepositData),
          deposit.proof,
          4,
          deposit.index,
          eth1.depositRoot
        )
      ).to.be.true;
    });
  });

});
