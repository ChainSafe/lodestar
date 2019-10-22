import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {GENESIS_SLOT} from "../../../../src/constants";
import {processEpoch} from "../../../../../eth2.0-state-transition/src/epoch";
import * as justificationUtils from "../../../../../eth2.0-state-transition/src/epoch/justification";
import {processJustificationAndFinalization} from "../../../../../eth2.0-state-transition/src/epoch/justification";
import * as crosslinkUtils from "../../../../../eth2.0-state-transition/src/epoch/crosslinks";
import * as balanceUpdateUtils from "../../../../../eth2.0-state-transition/src/epoch/balanceUpdates";
import {processRewardsAndPenalties} from "../../../../../eth2.0-state-transition/src/epoch/balanceUpdates";
import * as registryUpdateUtils from "../../../../../eth2.0-state-transition/src/epoch/registryUpdates";
import * as slashingUtils from "../../../../../eth2.0-state-transition/src/epoch/slashings";
import * as finalUtils from "../../../../../eth2.0-state-transition/src/epoch/finalUpdates";
import {processRegistryUpdates} from "../../../../../eth2.0-state-transition/src/epoch/registryUpdates";
import {processFinalUpdates} from "../../../../../eth2.0-state-transition/src/epoch/finalUpdates";
import {generateState} from "../../../utils/state";

describe('process epoch - crosslinks', function () {

  const sandbox = sinon.createSandbox();

  let processJustificationAndFinalizationStub: any,
    processCrosslinksStub: any,
    processRewardsAndPenaltiesStub: any,
    processRegistryUpdatesStub: any,
    processSlashingsStub: any,
    processFinalUpdatesStub: any;

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
