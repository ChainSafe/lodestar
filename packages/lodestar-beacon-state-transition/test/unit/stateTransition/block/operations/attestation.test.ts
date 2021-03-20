import {expect} from "chai";
import sinon from "sinon";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ZERO_HASH} from "../../../../../src/constants";
import * as utils from "../../../../../src/util";
import {phase0} from "../../../../../src";
import {generateState} from "../../../../utils/state";
import {generateEmptyAttestation} from "../../../../utils/attestation";
import {SinonStubFn} from "../../../../utils/types";

describe("process block - attestation", function () {
  const sandbox = sinon.createSandbox();

  let currentEpochStub: SinonStubFn<typeof utils["getCurrentEpoch"]>,
    previousEpochStub: SinonStubFn<typeof utils["getPreviousEpoch"]>,
    validateIndexedAttestationStub: SinonStubFn<typeof utils["isValidIndexedAttestation"]>,
    getBeaconProposerIndexStub: SinonStubFn<typeof utils["getBeaconProposerIndex"]>,
    getBeaconComitteeStub: SinonStubFn<typeof utils["getBeaconCommittee"]>;

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
    const state = generateState({slot: config.params.MIN_ATTESTATION_INCLUSION_DELAY + 1});
    const attestation = generateEmptyAttestation();
    expect(() => phase0.processAttestation(config, state, attestation)).to.throw;
  });

  it("fail to process attestation - future epoch", function () {
    const state = generateState({slot: 0});
    const attestation = generateEmptyAttestation();
    expect(() => phase0.processAttestation(config, state, attestation)).to.throw;
  });

  it("fail to process attestation - crosslink not zerohash", function () {
    const state = generateState({slot: 0});
    const attestation = generateEmptyAttestation();
    expect(() => phase0.processAttestation(config, state, attestation)).to.throw;
  });

  it.skip("should process attestation - currentEpoch === data.targetEpoch", function () {
    const state = generateState({
      slot: config.params.MIN_ATTESTATION_INCLUSION_DELAY + 1,
      currentJustifiedCheckpoint: {epoch: 1, root: ZERO_HASH},
    });
    currentEpochStub.returns(1);
    previousEpochStub.returns(0);
    validateIndexedAttestationStub.returns(true);
    getBeaconProposerIndexStub.returns(2);
    const attestation = generateEmptyAttestation();
    attestation.data.slot = config.params.SLOTS_PER_EPOCH + 1;
    attestation.data.target.epoch = 1;
    attestation.data.source.epoch = 1;
    attestation.data.source.root = state.currentJustifiedCheckpoint.root;
    getBeaconComitteeStub.returns(Array.from({length: attestation.aggregationBits.length}));
    expect(phase0.processAttestation(config, state, attestation)).to.not.throw;
    expect(state.currentEpochAttestations.length).to.be.equal(1);
    expect(state.previousEpochAttestations.length).to.be.equal(0);
  });

  it.skip("should process attestation - previousEpoch === data.targetEpoch", function () {
    const state = generateState({
      slot: config.params.MIN_ATTESTATION_INCLUSION_DELAY + 1,
      currentJustifiedCheckpoint: {epoch: 1, root: ZERO_HASH},
    });
    currentEpochStub.returns(1);
    previousEpochStub.returns(0);
    validateIndexedAttestationStub.returns(true);
    getBeaconProposerIndexStub.returns(2);
    const attestation = generateEmptyAttestation();
    attestation.data.target.epoch = 0;
    attestation.data.source.epoch = 0;
    attestation.data.source.root = state.previousJustifiedCheckpoint.root;
    getBeaconComitteeStub.returns(Array.from({length: attestation.aggregationBits.length}));
    expect(phase0.processAttestation(config, state, attestation)).to.not.throw;
    expect(state.currentEpochAttestations.length).to.be.equal(0);
    expect(state.previousEpochAttestations.length).to.be.equal(1);
  });
});
