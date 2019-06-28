import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {generateEmptyBlock} from "../../../../utils/block";
import {processEth1Data} from "../../../../../src/chain/stateTransition/block/eth1Data";
import {processBlockHeader} from "../../../../../src/chain/stateTransition/block/blockHeader";
import {processRandao} from "../../../../../src/chain/stateTransition/block/randao";
import {processBlock} from "../../../../../src/chain/stateTransition";
import {processOperations} from "../../../../../src/chain/stateTransition/block/operations";

describe('process block', function () {

  const sandbox = sinon.createSandbox();

  let processEth1Stub,
    processBlockHeaderStub,
    processRandaoStub,
    processOperationsStub
  ;

  beforeEach(() => {
    processBlockHeaderStub = sandbox.stub(processBlockHeader);
    processRandaoStub = sandbox.stub(processRandao);
    processEth1Stub = sandbox.stub(processEth1Data);
    processOperationsStub = sandbox.stub(processOperations);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process block', function () {
    processBlock(generateState(), generateEmptyBlock(), false);
    expect(processEth1Stub.calledOnce).to.be.true;
    expect(processBlockHeaderStub.calledOnce).to.be.true;
    expect(processRandaoStub.calledOnce).to.be.true;
    expect(processOperationsStub.calledOnce).to.be.true;
  });

});
