import * as blockBodyAssembly from "../../../../../src/chain/factory/block/body";
import * as blockTransitions from "../../../../../src/chain/stateTransition/block";
import sinon from "sinon";
import {OpPool} from "../../../../../src/opPool";
import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {assembleBlock} from "../../../../../src/chain/factory/block";
import {expect} from "chai";
import {BeaconDB} from "../../../../../src/db/api";
import {EthersEth1Notifier} from "../../../../../src/eth1";

describe('block assembly', function () {

  const sandbox = sinon.createSandbox();

  let assembleBodyStub, processBlockStub, opPool, beaconDB, eth1;

  beforeEach(() => {
    assembleBodyStub = sandbox.stub(blockBodyAssembly, 'assembleBody');
    processBlockStub = sandbox.stub(blockTransitions, 'processBlock');
    opPool = sandbox.createStubInstance(OpPool);
    beaconDB = sandbox.createStubInstance(BeaconDB);
    eth1 = sandbox.createStubInstance(EthersEth1Notifier);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should assemble block', async function() {
    beaconDB.getLatestState.resolves(generateState({slot: 1}));
    beaconDB.getChainHead.resolves(generateEmptyBlock());
    assembleBodyStub.resolves(generateEmptyBlock().body);
    try {
      const result = await assembleBlock(beaconDB, opPool, eth1, 1, Buffer.alloc(96, 0));
      expect(result).to.not.be.null;
      expect(result.slot).to.equal(1);
      expect(result.stateRoot).to.not.be.null;
      expect(result.parentRoot).to.not.be.null;
      expect(beaconDB.getLatestState.calledOnce).to.be.true;
      expect(beaconDB.getChainHead.calledOnce).to.be.true;
      expect(assembleBodyStub.calledOnce).to.be.true;
      expect(processBlockStub.withArgs(sinon.match.any, sinon.match.any).calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });
});
