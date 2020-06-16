import {expect} from "chai";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ZERO_HASH} from "../../../../../src/constants";
import {processAttestation} from "../../../../../src/block/operations";
import * as utils from "../../../../../src/util";
import {describe, it, beforeEach, afterEach} from "mocha";
import {generateState} from "../../../../utils/state";
import {generateEmptyAttestation} from "../../../../utils/attestation";

describe("process block - attestation", function () {

  const sandbox = sinon.createSandbox();

  let currentEpochStub: any, previousEpochStub: any, validateIndexedAttestationStub: any,
    getBeaconProposerIndexStub: any, getBeaconComitteeStub: any;

  beforeEach(() => {
    currentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    previousEpochStub = sandbox.stub(utils, "getPreviousEpoch");
    getBeaconComitteeStub = sandbox.stub(utils, "getBeaconCommittee");
    validateIndexedAttestationStub = sandbox.stub(utils, "isValidIndexedAttestation");
    getBeaconProposerIndexStub = sandbox.stub(utils, "getBeaconProposerIndex");
    sandbox.stub(utils, "getIndexedAttestation");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("fail to process attestation - exceeds inclusion delay", function () {
    const state = generateState({slot: config.params.MIN_ATTESTATION_INCLUSION_DELAY + 1n});
    const attestation = generateEmptyAttestation();
    expect(() => processAttestation(config, state, attestation)).to.throw;
  });

  it("fail to process attestation - future epoch", function () {
    const state = generateState({slot: 0n});
    const attestation = generateEmptyAttestation();
    expect(() => processAttestation(config, state, attestation)).to.throw;
  });

  it("fail to process attestation - crosslink not zerohash", function () {
    const state = generateState({slot: 0n});
    const attestation = generateEmptyAttestation();
    expect(() => processAttestation(config, state, attestation)).to.throw;
  });

  it("should process attestation - currentEpoch === data.targetEpoch", function () {
    const state = generateState({
      slot: config.params.MIN_ATTESTATION_INCLUSION_DELAY + 1n,
      currentJustifiedCheckpoint: {epoch: 1n, root: ZERO_HASH}
    });
    currentEpochStub.returns(1);
    previousEpochStub.returns(0);
    validateIndexedAttestationStub.returns(true);
    getBeaconProposerIndexStub.returns(2);
    const attestation = generateEmptyAttestation();
    attestation.data.slot = config.params.SLOTS_PER_EPOCH + 1n;
    attestation.data.target.epoch = 1n;
    attestation.data.source.epoch = 1n;
    attestation.data.source.root = state.currentJustifiedCheckpoint.root;
    getBeaconComitteeStub.returns(Array.from({length: attestation.aggregationBits.length}));
    expect(processAttestation(config, state, attestation)).to.not.throw;
    expect(state.currentEpochAttestations.length).to.be.equal(1);
    expect(state.previousEpochAttestations.length).to.be.equal(0);
  });

  it("should process attestation - previousEpoch === data.targetEpoch", function () {
    const state = generateState({
      slot: config.params.MIN_ATTESTATION_INCLUSION_DELAY + 1n,
      currentJustifiedCheckpoint: {epoch: 1n, root: ZERO_HASH}
    });
    currentEpochStub.returns(1);
    previousEpochStub.returns(0);
    validateIndexedAttestationStub.returns(true);
    getBeaconProposerIndexStub.returns(2);
    const attestation = generateEmptyAttestation();
    attestation.data.target.epoch = 0n;
    attestation.data.source.epoch = 0n;
    attestation.data.source.root = state.previousJustifiedCheckpoint.root;
    getBeaconComitteeStub.returns(Array.from({length: attestation.aggregationBits.length}));
    expect(processAttestation(config, state, attestation)).to.not.throw;
    expect(state.currentEpochAttestations.length).to.be.equal(0);
    expect(state.previousEpochAttestations.length).to.be.equal(1);
  });

});
