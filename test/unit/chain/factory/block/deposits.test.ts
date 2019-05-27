import sinon from "sinon";
import {OpPool} from "../../../../src/opPool";
import {blockDeposits} from "../../../../src/chain/factory/block/deposits";
import {generateState} from "../../../utils/state";
import {expect} from "chai";

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
    const result = await blockDeposits(opPool, generateState({
      depositIndex: 1,
      latestEth1Data: {
        depositCount: 2,
        depositRoot: null,
        blockHash: null
      }
    }));
    expect(result).to.be.deep.equal([]);
  });

});
