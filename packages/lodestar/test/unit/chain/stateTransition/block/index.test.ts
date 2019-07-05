import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {generateEmptyBlock} from "../../../../utils/block";
import * as processEth1Data from "../../../../../src/chain/stateTransition/block/eth1Data";
import * as processBlockHeader from "../../../../../src/chain/stateTransition/block/blockHeader";
import * as processRandao from "../../../../../src/chain/stateTransition/block/randao";
import {processBlock} from "../../../../../src/chain/stateTransition";
import * as processOperations from "../../../../../src/chain/stateTransition/block/operations";

describe('process block', function () {

  const sandbox = sinon.createSandbox();

  let processEth1Stub,
    processBlockHeaderStub,
    processRandaoStub,
    processOperationsStub
  ;

  beforeEach(() => {
    processBlockHeaderStub = sandbox.stub(processBlockHeader,'processBlockHeader');
    processRandaoStub = sandbox.stub(processRandao, 'processRandao');
    processEth1Stub = sandbox.stub(processEth1Data, 'processEth1Data');
    processOperationsStub = sandbox.stub(processOperations, 'processOperations');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process block', function () {
    processEth1Stub.returns(0);
    processBlockHeaderStub.returns(0);
    processRandaoStub.returns(0);
    processOperationsStub.returns(0);
    processBlock(generateState(), generateEmptyBlock(), false);
    expect(processEth1Stub.calledOnce).to.be.true;
    expect(processBlockHeaderStub.calledOnce).to.be.true;
    expect(processRandaoStub.calledOnce).to.be.true;
    expect(processOperationsStub.calledOnce).to.be.true;
  });

});
