import {expect} from "chai";
import sinon from "sinon";

import {List} from "@chainsafe/ssz";
import {phase0} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {
  getAttestingBalance,
  getMatchingHeadAttestations,
  getMatchingSourceAttestations,
  getMatchingTargetAttestations,
  getUnslashedAttestingIndices,
} from "../../../../src/phase0/naive/epoch/util";
import * as utils from "../../../../src/util";
import {FAR_FUTURE_EPOCH} from "../../../../src/constants";
import {generateEmptyAttestation} from "../../../utils/attestation";
import {generateValidator} from "../../../utils/validator";
import {generateState} from "../../../utils/state";
import {SinonStubFn} from "../../../utils/types";

describe("process epoch - crosslinks", function () {
  const sandbox = sinon.createSandbox();

  let getActiveValidatorIndicesStub: SinonStubFn<typeof utils["getActiveValidatorIndices"]>,
    getTotalBalanceStub: SinonStubFn<typeof utils["getTotalBalance"]>,
    getBlockRootStub: SinonStubFn<typeof utils["getBlockRoot"]>,
    getBlockRootAtSlotStub: SinonStubFn<typeof utils["getBlockRootAtSlot"]>,
    getAttestingIndicesStub: SinonStubFn<typeof utils["getAttestingIndices"]>;

  beforeEach(() => {
    getActiveValidatorIndicesStub = sandbox.stub(utils, "getActiveValidatorIndices");
    getAttestingIndicesStub = sandbox.stub(utils, "getAttestingIndices");
    getTotalBalanceStub = sandbox.stub(utils, "getTotalBalance");
    getBlockRootStub = sandbox.stub(utils, "getBlockRoot");
    getBlockRootAtSlotStub = sandbox.stub(utils, "getBlockRootAtSlot");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should get total active balance", function () {
    const validatorIndices = [1, 2];
    getActiveValidatorIndicesStub.returns(validatorIndices);

    utils.getTotalActiveBalance(config, generateState());
  });

  it("should get matching source attestation - for current epoch", function () {
    const pendingAttestations = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
    ];
    const state = generateState({
      slot: config.params.SLOTS_PER_EPOCH,
      currentEpochAttestations: pendingAttestations as List<phase0.PendingAttestation>,
    });

    const result = getMatchingSourceAttestations(config, state, 1);
    expect(result).to.be.deep.equal(pendingAttestations);
  });

  it("should get matching source attestation - for previous epoch", function () {
    const currentPendingAttestations = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
    ];
    const previousPendingAttestations = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 2,
      },
    ];
    const state = generateState({
      slot: config.params.SLOTS_PER_EPOCH,
      currentEpochAttestations: currentPendingAttestations as List<phase0.PendingAttestation>,
      previousEpochAttestations: previousPendingAttestations as List<phase0.PendingAttestation>,
    });

    const result = getMatchingSourceAttestations(config, state, 0);
    expect(result).to.be.deep.equal(previousPendingAttestations);
  });

  it.skip("should get matching target attestation", function () {
    const blockRoot = Buffer.alloc(36, 2);
    const currentPendingAttestations = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
    ];
    currentPendingAttestations[0].data.target.root = blockRoot;
    const state = generateState({
      slot: config.params.SLOTS_PER_EPOCH,
      currentEpochAttestations: currentPendingAttestations as List<phase0.PendingAttestation>,
    });
    getBlockRootStub.returns(blockRoot);

    const result = getMatchingTargetAttestations(config, state, 1);
    expect(getBlockRootStub.calledOnce).to.be.true;
    expect(result).to.be.deep.equal([currentPendingAttestations[0]]);
  });

  it.skip("should get matching head attestation", function () {
    const blockRoot = Buffer.alloc(32, 2);
    const currentPendingAttestations = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
    ];
    currentPendingAttestations[0].data.beaconBlockRoot = blockRoot;
    const state = generateState({
      slot: config.params.SLOTS_PER_EPOCH,
      currentEpochAttestations: currentPendingAttestations as List<phase0.PendingAttestation>,
    });
    getBlockRootAtSlotStub.returns(blockRoot);
    getBlockRootStub.returns(Buffer.alloc(32));

    const result = getMatchingHeadAttestations(config, state, 1);
    expect(getBlockRootAtSlotStub.withArgs(config, sinon.match.any, 1).calledTwice).to.be.true;
    expect(result).to.be.deep.equal([currentPendingAttestations[0]]);
  });

  it.skip("should get unslashed attesting indices", function () {
    const pendingAttestations = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
    ];
    getAttestingIndicesStub.returns([0, 1]);
    const validator1 = generateValidator({activation: 0, exit: FAR_FUTURE_EPOCH, slashed: true});
    const validator2 = generateValidator({activation: 0, exit: FAR_FUTURE_EPOCH, slashed: false});
    const state = generateState({validators: [validator1, validator2] as List<phase0.Validator>});

    const result = getUnslashedAttestingIndices(config, state, pendingAttestations);
    expect(result).to.be.deep.equal([1]);
    expect(getAttestingIndicesStub.calledTwice).to.be.true;
  });

  it.skip("should get attesting balance", function () {
    const pendingAttestations = [
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
      {
        ...generateEmptyAttestation(),
        inclusionDelay: 10,
        proposerIndex: 1,
      },
    ];
    getAttestingIndicesStub.returns([0, 1]);
    const validator1 = generateValidator({activation: 0, exit: FAR_FUTURE_EPOCH, slashed: true});
    const validator2 = generateValidator({activation: 0, exit: FAR_FUTURE_EPOCH, slashed: false});
    const state = generateState({validators: [validator1, validator2] as List<phase0.Validator>});
    getTotalBalanceStub.returns(BigInt(1));

    const result = getAttestingBalance(config, state, pendingAttestations);
    expect(result.toString()).to.be.deep.equal(BigInt(1).toString());
    expect(getTotalBalanceStub.withArgs(sinon.match.any, sinon.match.any, [1]).calledOnce).to.be.true;
  });
});
