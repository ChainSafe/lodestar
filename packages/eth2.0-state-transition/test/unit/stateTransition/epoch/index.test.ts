import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {GENESIS_SLOT} from "../../../../src/constants";
import {processEpoch} from "../../../../src/epoch";
import * as justificationUtils from "../../../../src/epoch/justification";
import {processJustificationAndFinalization} from "../../../../src/epoch/justification";
import * as balanceUpdateUtils from "../../../../src/epoch/balanceUpdates";
import {processRewardsAndPenalties} from "../../../../src/epoch/balanceUpdates";
import * as registryUpdateUtils from "../../../../src/epoch/registryUpdates";
import * as slashingUtils from "../../../../src/epoch/slashings";
import * as finalUtils from "../../../../src/epoch/finalUpdates";
import {processRegistryUpdates} from "../../../../src/epoch/registryUpdates";
import {processFinalUpdates} from "../../../../src/epoch/finalUpdates";
import {generateState} from "../../../utils/state";

describe('process epoch - crosslinks', function () {

  const sandbox = sinon.createSandbox();

  let processJustificationAndFinalizationStub: any,
    processRewardsAndPenaltiesStub: any,
    processRegistryUpdatesStub: any,
    processSlashingsStub: any,
    processFinalUpdatesStub: any;

  beforeEach(() => {
    processJustificationAndFinalizationStub =
      sandbox.stub(justificationUtils, "processJustificationAndFinalization");
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
      expect(processRewardsAndPenaltiesStub.calledOnce).to.be.true;
      expect(processRegistryUpdatesStub.calledOnce).to.be.true;
      expect(processSlashingsStub.calledOnce).to.be.true;
      expect(processFinalUpdatesStub.calledOnce).to.be.true;
    } catch (e) {
      expect.fail(e.stack);
    }
  });

});
