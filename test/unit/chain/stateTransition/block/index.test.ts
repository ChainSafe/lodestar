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

describe('process block', function () {

  const sandbox = sinon.createSandbox();

  let processEth1Stub,
    processBlockHeaderStub,
    processAttestationsStub,
    processAttesterSlashingStub,
    processDepositsStub,
    processRandaoStub,
    processRootVerificationStub,
    processTransfersStub,
    processVoluntaryExitsStub,
    processProposerSlashingsStub
  ;

  beforeEach(() => {
    processEth1Stub = sandbox.stub(eth1Utils, "default");
    processBlockHeaderStub = sandbox.stub(blockHeaderUtils, "default");
    processAttestationsStub = sandbox.stub(attestationUtils, "default");
    processAttesterSlashingStub = sandbox.stub(attesterSlashingUtils, "default");
    processDepositsStub = sandbox.stub(depositUtils, "default");
    processProposerSlashingsStub = sandbox.stub(proposserSlashingUtils, "default");
    processRandaoStub = sandbox.stub(randaoUtils, "default");
    processRootVerificationStub = sandbox.stub(rootVerificationUtils, "default");
    processTransfersStub = sandbox.stub(transferUtils, "default");
    processVoluntaryExitsStub = sandbox.stub(voluntaryExitUtils, "default");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should process block - with verification', function () {
    processBlock(generateState(), generateEmptyBlock());
    expect(processEth1Stub.calledOnce).to.be.true;
    expect(processBlockHeaderStub.calledOnce).to.be.true;
    expect(processAttestationsStub.calledOnce).to.be.true;
    expect(processAttesterSlashingStub.calledOnce).to.be.true;
    expect(processDepositsStub.calledOnce).to.be.true;
    expect(processProposerSlashingsStub.calledOnce).to.be.true;
    expect(processRootVerificationStub.calledOnce).to.be.true;
    expect(processTransfersStub.calledOnce).to.be.true;
    expect(processVoluntaryExitsStub.calledOnce).to.be.true;
  });

  it('should process block - without verification', function () {
    processBlock(generateState(), generateEmptyBlock());
    expect(processEth1Stub.calledOnce).to.be.true;
    expect(processBlockHeaderStub.calledOnce).to.be.true;
    expect(processAttestationsStub.calledOnce).to.be.true;
    expect(processAttesterSlashingStub.calledOnce).to.be.true;
    expect(processDepositsStub.calledOnce).to.be.true;
    expect(processProposerSlashingsStub.calledOnce).to.be.true;
    expect(processRootVerificationStub.notCalled).to.be.true;
    expect(processTransfersStub.calledOnce).to.be.true;
    expect(processVoluntaryExitsStub.calledOnce).to.be.true;
  });

});
