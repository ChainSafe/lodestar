import {expect} from "chai";
import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/mainnet";
import * as utilsEpoch from "../../../../../src/phase0/naive/epoch/util";
import * as utils from "../../../../../src/util";
import * as baseReward from "../../../../../src/phase0/naive/epoch/balanceUpdates/util";

import {generateState} from "../../../../utils/state";
import {generateValidators} from "../../../../utils/validator";
import {getAttestationDeltas} from "../../../../../src/phase0/naive/epoch/balanceUpdates/attestation";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {SinonStubFn} from "../../../../utils/types";

describe.skip("process epoch - balance updates", function () {
  const sandbox = sinon.createSandbox();

  let getAttestingBalanceStub: SinonStubFn<typeof utilsEpoch["getAttestingBalance"]>,
    getMatchingHeadAttestationsStub: SinonStubFn<typeof utilsEpoch["getMatchingHeadAttestations"]>,
    getMatchingSourceAttestationsStub: SinonStubFn<typeof utilsEpoch["getMatchingSourceAttestations"]>,
    getMatchingTargetAttestationsStub: SinonStubFn<typeof utilsEpoch["getMatchingTargetAttestations"]>,
    getTotalActiveBalanceStub: SinonStubFn<typeof utils["getTotalActiveBalance"]>,
    getUnslashedAttestingIndicesStub: SinonStubFn<typeof utilsEpoch["getUnslashedAttestingIndices"]>,
    getBaseRewardStub: SinonStubFn<typeof baseReward["getBaseReward"]>,
    getAttestingIndicesStub: SinonStubFn<typeof utils["getAttestingIndices"]>,
    getPreviousEpochStub: SinonStubFn<typeof utils["getPreviousEpoch"]>,
    isActiveValidatorStub: SinonStubFn<typeof utils["isActiveValidator"]>;

  beforeEach(() => {
    getAttestingBalanceStub = sandbox.stub(utilsEpoch, "getAttestingBalance");
    getMatchingHeadAttestationsStub = sandbox.stub(utilsEpoch, "getMatchingHeadAttestations");
    getMatchingSourceAttestationsStub = sandbox.stub(utilsEpoch, "getMatchingSourceAttestations");
    getMatchingTargetAttestationsStub = sandbox.stub(utilsEpoch, "getMatchingTargetAttestations");
    getTotalActiveBalanceStub = sandbox.stub(utils, "getTotalActiveBalance");
    getUnslashedAttestingIndicesStub = sandbox.stub(utilsEpoch, "getUnslashedAttestingIndices");
    getBaseRewardStub = sandbox.stub(baseReward, "getBaseReward");
    getAttestingIndicesStub = sandbox.stub(utils, "getAttestingIndices");
    getPreviousEpochStub = sandbox.stub(utils, "getPreviousEpoch");
    isActiveValidatorStub = sandbox.stub(utils, "isActiveValidator");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should return rewards", function () {
    const state = generateState();
    state.validators = generateValidators(2);
    getPreviousEpochStub.returns(5);
    getTotalActiveBalanceStub.returns(BigInt(32));
    isActiveValidatorStub.returns(true);
    getAttestingBalanceStub.returns(BigInt(10));
    const emptyPendingAttestation = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 5,
        proposerIndex: 1,
      },
    ];
    getUnslashedAttestingIndicesStub.returns([0, 1]);
    getMatchingSourceAttestationsStub.returns(emptyPendingAttestation);
    getMatchingTargetAttestationsStub.returns(emptyPendingAttestation);
    getMatchingHeadAttestationsStub.returns(emptyPendingAttestation);
    getBaseRewardStub.returns(BigInt(10));
    getAttestingIndicesStub.returns([0, 1]);

    const result = getAttestationDeltas(config, state);
    const rewards = result[0];
    for (const value of rewards) {
      expect(value > BigInt(0)).to.be.true;
    }
  });

  it("should return penalties", function () {
    const state = generateState();
    state.validators = generateValidators(4);
    getPreviousEpochStub.returns(5);
    getTotalActiveBalanceStub.returns(BigInt(100));
    isActiveValidatorStub.returns(true);
    getAttestingBalanceStub.returns(BigInt(2));
    const emptyPendingAttestation = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
    ];
    getUnslashedAttestingIndicesStub.returns([2, 3]);
    getMatchingSourceAttestationsStub.returns(emptyPendingAttestation);
    getMatchingTargetAttestationsStub.returns(emptyPendingAttestation);
    getMatchingHeadAttestationsStub.returns(emptyPendingAttestation);
    getBaseRewardStub.returns(BigInt(2));
    getAttestingIndicesStub.returns([2, 3]);

    const result = getAttestationDeltas(config, state);
    const penalties = result[1];
    for (const value of penalties) {
      expect(value > BigInt(0)).to.be.true;
    }
  });
});
