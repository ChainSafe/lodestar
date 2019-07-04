import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import sinon from "sinon";
import {processEpoch} from "../../../../../chain/stateTransition/epoch";
import * as justificationUtils from "../../../../../chain/stateTransition/epoch/justification";
import {processJustificationAndFinalization} from "../../../../../chain/stateTransition/epoch/justification";
import * as crosslinkUtils from "../../../../../chain/stateTransition/epoch/crosslinks";
import * as balanceUpdateUtils from "../../../../../chain/stateTransition/epoch/balanceUpdates";
import {processRewardsAndPenalties} from "../../../../../chain/stateTransition/epoch/balanceUpdates";
import * as registryUpdateUtils from "../../../../../chain/stateTransition/epoch/registryUpdates";
import * as slashingUtils from "../../../../../chain/stateTransition/epoch/slashings";
import * as finalUtils from "../../../../../chain/stateTransition/epoch/finalUpdates";
import {processRegistryUpdates} from "../../../../../chain/stateTransition/epoch/registryUpdates";
import {GENESIS_SLOT, SLOTS_PER_EPOCH} from "../../../../../constants";
import {processFinalUpdates} from "../../../../../chain/stateTransition/epoch/finalUpdates";

describe('process epoch - crosslinks', function () {

  const sandbox = sinon.createSandbox();

  let processJustificationAndFinalizationStub,
    processCrosslinksStub,
    processRewardsAndPenaltiesStub,
    processRegistryUpdatesStub,
    processSlashingsStub,
    processFinalUpdatesStub;

  beforeEach(() => {
    processJustificationAndFinalizationStub =
      sandbox.stub(justificationUtils, "processJustificationAndFinalization");
    processCrosslinksStub = sandbox.stub(
      crosslinkUtils, "processCrosslinks");
    processRewardsAndPenaltiesStub = sandbox.stub(
      balanceUpdateUtils, "processRewardsAndPenalties");
    processRegistryUpdatesStub = sandbox.stub(
      registryUpdateUtils, "processRegistryUpdates");
    processSlashingsStub = sandbox.stub(
      slashingUtils, "processSlashings");
    processFinalUpdatesStub = sandbox.stub(
      finalUtils, "processFinalUpdates");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should fail to process - genesis slot', function () {
    try {
      processEpoch(generateState({slot: GENESIS_SLOT}));
      expect.fail();
    } catch (e) {

    }
  });

  it('should fail to process - not epoch', function () {
    try {
      processEpoch(generateState({slot: 1}));
      expect.fail();
    } catch (e) {

    }
  });

  it('should process epoch', function () {
    try {
      processEpoch(generateState({slot: SLOTS_PER_EPOCH - 1}));
      expect(processJustificationAndFinalizationStub.calledOnce).to.be.true;
      expect(processCrosslinksStub.calledOnce).to.be.true;
      expect(processRewardsAndPenaltiesStub.calledOnce).to.be.true;
      expect(processRegistryUpdatesStub.calledOnce).to.be.true;
      expect(processSlashingsStub.calledOnce).to.be.true;
      expect(processFinalUpdatesStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
