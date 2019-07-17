import BN from "bn.js";
import {expect} from "chai";
import sinon from "sinon";
import * as utilsEpoch from "../../../../../../src/chain/stateTransition/epoch/util";
import * as utils from "../../../../../../src/chain/stateTransition/util";
import * as baseReward from "../../../../../../src/chain/stateTransition/epoch/balanceUpdates/baseReward";

import {generateState} from "../../../../../utils/state";
import {generateValidators} from "../../../../../utils/validator";
import {getAttestationDeltas} from "../../../../../../src/chain/stateTransition/epoch/balanceUpdates/attestation";
import {generateEmptyAttestation} from "../../../../../utils/attestation";
import {createIBeaconConfig} from "../../../../../../src/config";
import * as mainnetParams from "../../../../../../src/params/presets/mainnet";


describe('process epoch - balance updates', function () {

  const sandbox = sinon.createSandbox();
  let config = createIBeaconConfig(mainnetParams);

  let getAttestingBalanceStub,
    getMatchingHeadAttestationsStub,
    getMatchingSourceAttestationsStub,
    getMatchingTargetAttestationsStub,
    getTotalActiveBalanceStub,
    getUnslashedAttestingIndicesStub,
    getBaseRewardStub,
    getAttestingIndicesStub,
    getPreviousEpochStub,
    isActiveValidatorStub;

  beforeEach(() => {
    getAttestingBalanceStub = sandbox.stub(utilsEpoch, "getAttestingBalance");
    getMatchingHeadAttestationsStub = sandbox.stub(utilsEpoch, "getMatchingHeadAttestations");
    getMatchingSourceAttestationsStub = sandbox.stub(utilsEpoch, "getMatchingSourceAttestations");
    getMatchingTargetAttestationsStub = sandbox.stub(utilsEpoch, "getMatchingTargetAttestations");
    getTotalActiveBalanceStub = sandbox.stub(utilsEpoch, "getTotalActiveBalance");
    getUnslashedAttestingIndicesStub = sandbox.stub(utilsEpoch, "getUnslashedAttestingIndices");
    getBaseRewardStub = sandbox.stub(baseReward, "getBaseReward");
    getAttestingIndicesStub = sandbox.stub(utils, "getAttestingIndices");
    getPreviousEpochStub = sandbox.stub(utils, "getPreviousEpoch");
    isActiveValidatorStub = sandbox.stub(utils, "isActiveValidator");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return rewards', function () {
    const state  = generateState();
    state.validatorRegistry = generateValidators(2);
    getPreviousEpochStub.returns(5);
    getTotalActiveBalanceStub.returns(new BN(32));
    isActiveValidatorStub.returns(true);
    getAttestingBalanceStub.returns(new BN(10));
    const emptyPendingAttestation = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1
      }
    ];
    getUnslashedAttestingIndicesStub.returns([0, 1]);
    getMatchingSourceAttestationsStub.returns(emptyPendingAttestation);
    getMatchingTargetAttestationsStub.returns(emptyPendingAttestation);
    getMatchingHeadAttestationsStub.returns(emptyPendingAttestation);
    getBaseRewardStub.returns(new BN(10));
    getAttestingIndicesStub.returns([0, 1]);

    try {
      const result  = getAttestationDeltas(config, state);
      const rewards = result[0];
      const penalties = result[1];
      rewards.forEach((value)=>{
        expect(value.gt(new BN(0))).to.be.true;
      });
    }catch (e) {
      expect.fail(e.stack);
    }

  });

  it('should return penalties', function () {
    const state  = generateState();
    state.validatorRegistry = generateValidators(4);
    getPreviousEpochStub.returns(5);
    getTotalActiveBalanceStub.returns(new BN(100));
    isActiveValidatorStub.returns(true);
    getAttestingBalanceStub.returns(new BN(2));
    const emptyPendingAttestation = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1
      }
    ];
    getUnslashedAttestingIndicesStub.returns([2, 3]);
    getMatchingSourceAttestationsStub.returns(emptyPendingAttestation);
    getMatchingTargetAttestationsStub.returns(emptyPendingAttestation);
    getMatchingHeadAttestationsStub.returns(emptyPendingAttestation);
    getBaseRewardStub.returns(new BN(2));
    getAttestingIndicesStub.returns([2, 3]);
    try {
      const result  = getAttestationDeltas(config, state);
      const rewards = result[0];
      const penalties = result[1];
      penalties.forEach((value)=>{
        expect(value.gt(new BN(0))).to.be.true;
      });
      rewards.forEach((value)=>{
        expect(value.eq(new BN(0))).to.be.true;
      });
    }catch (e) {
      expect.fail(e.stack);
    }
  });

});
