import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {generateEmptyBlock} from "../../../../utils/block";
import * as eth1Utils from "../../../../../src/chain/stateTransition/block/eth1Data";
import * as attestationUtils from "../../../../../src/chain/stateTransition/block/attestations";
import * as attesterSlashingUtils from "../../../../../src/chain/stateTransition/block/attesterSlashings";
import * as blockHeaderUtils from "../../../../../src/chain/stateTransition/block/blockHeader";
import * as depositUtils from "../../../../../src/chain/stateTransition/block/deposits";
import * as proposserSlashingUtils from "../../../../../src/chain/stateTransition/block/proposerSlashings";
import * as randaoUtils from "../../../../../src/chain/stateTransition/block/randao";
import * as rootVerificationUtils from "../../../../../src/chain/stateTransition/block/rootVerification";
import * as transferUtils from "../../../../../src/chain/stateTransition/block/transfers";
import * as voluntaryExitUtils from "../../../../../src/chain/stateTransition/block/voluntaryExits";
import {processBlock} from "../../../../../src/chain/stateTransition";
import * as processOperationUtils from "../../../../../src/chain/stateTransition/block/operations";

describe('process block', function () {

  const sandbox = sinon.createSandbox();

  let processEth1Stub,
    processBlockHeaderStub,
    processRandaoStub,
    processOperationsStub
  ;

  beforeEach(() => {
    processEth1Stub = sandbox.stub(eth1Utils, "default");
    processBlockHeaderStub = sandbox.stub(blockHeaderUtils, "default");
    processRandaoStub = sandbox.stub(randaoUtils, "default");
    processOperationsStub = sandbox.stub(processOperationUtils, "default");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process block', function () {
    processBlock(generateState(), generateEmptyBlock());
    expect(processEth1Stub.calledOnce).to.be.true;
    expect(processBlockHeaderStub.calledOnce).to.be.true;
    expect(processRandaoStub.calledOnce).to.be.true;
    expect(processOperationsStub.calledOnce).to.be.true;
  });

});
