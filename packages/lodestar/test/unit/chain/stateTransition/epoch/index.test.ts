import {expect} from "chai";
import sinon from "sinon";
import {GENESIS_SLOT} from "../../../../../src/constants";
import {processEpoch} from "../../../../../src/chain/stateTransition/epoch";
import * as justificationUtils from "../../../../../src/chain/stateTransition/epoch/justification";
import {processJustificationAndFinalization} from "../../../../../src/chain/stateTransition/epoch/justification";
import * as crosslinkUtils from "../../../../../src/chain/stateTransition/epoch/crosslinks";
import * as balanceUpdateUtils from "../../../../../src/chain/stateTransition/epoch/balanceUpdates";
import {processRewardsAndPenalties} from "../../../../../src/chain/stateTransition/epoch/balanceUpdates";
import * as registryUpdateUtils from "../../../../../src/chain/stateTransition/epoch/registryUpdates";
import {processRegistryUpdates} from "../../../../../src/chain/stateTransition/epoch/registryUpdates";
import * as slashingUtils from "../../../../../src/chain/stateTransition/epoch/slashings";
import * as finalUtils from "../../../../../src/chain/stateTransition/epoch/finalUpdates";
import {processFinalUpdates} from "../../../../../src/chain/stateTransition/epoch/finalUpdates";
import {generateState} from "../../../../utils/state";
import {createIBeaconConfig} from "../../../../../src/config";
import * as mainnetParams from "../../../../../src/params/presets/mainnet";

describe('process epoch - crosslinks', function () {

  const sandbox = sinon.createSandbox();
  let config = createIBeaconConfig(mainnetParams);

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
      processEpoch(config, generateState({slot: GENESIS_SLOT}));
      expect.fail();
    } catch (e) {

    }
  });

  it('should fail to process - not epoch', function () {
    try {
      processEpoch(config, generateState({slot: 1}));
      expect.fail();
    } catch (e) {

    }
  });

  it('should process epoch', function () {
    try {
      processEpoch(config, generateState({slot: config.params.SLOTS_PER_EPOCH - 1}));
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
