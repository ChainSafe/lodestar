import sinon from "sinon";
import {expect} from "chai";
import {hashTreeRoot} from "@chainsafe/ssz";
import {ZERO_HASH} from "../../../../../src/constants";
import {OpPool} from "../../../../../src/opPool";
import {ProgressiveMerkleTree, verifyMerkleBranch} from "../../../../../src/util/merkleTree";
import {generateDeposits} from "../../../../../src/chain/factory/block/deposits";
import {generateState} from "../../../../utils/state";
import {generateDeposit} from "../../../../utils/deposit";
import {DepositsOperations} from "../../../../../src/opPool/modules";
import {createIBeaconConfig} from "../../../../../src/config";
import * as mainnetParams from "../../../../../src/params/presets/mainnet";

describe('blockAssembly - deposits', function() {

  const sandbox = sinon.createSandbox();
  let config = createIBeaconConfig(mainnetParams);
  let opPool;

  beforeEach(() => {
    opPool = sandbox.createStubInstance(OpPool);
    opPool.deposits = sandbox.createStubInstance(DepositsOperations);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('return empty array if no pending deposits', async function() {
    const result = await generateDeposits(
      config,
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
    opPool.deposits.getAll.resolves(deposits);
    const tree = ProgressiveMerkleTree.empty(4);
    deposits.forEach((d, index) => {
      tree.add(index, hashTreeRoot(d.data, config.types.DepositData));
    });
    const eth1 = {
      depositCount: 2,
      blockHash: ZERO_HASH,
      depositRoot: tree.root()
    };
    const result = await generateDeposits(
      config,
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
          hashTreeRoot(deposit.data, config.types.DepositData),
          deposit.proof,
          4,
          index,
          eth1.depositRoot
        )
      ).to.be.true;
    });
  });
});
