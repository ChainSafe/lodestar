import {expect} from "chai";
import sinon from "sinon";
import {hashTreeRoot} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {ZERO_HASH} from "../../../../../src/constants";
import {processAttestation} from "../../../../../src/block/operations";
import * as utils from "../../../../../src/util";
import {describe, it, beforeEach, afterEach} from "mocha";
import {generateState} from "../../../../utils/state";
import {generateEmptyAttestation} from "../../../../utils/attestation";

describe("process block - attestation", function () {

  const sandbox = sinon.createSandbox();

  let attestationSlotStub: any, currentEpochStub: any, previousEpochStub: any, validateIndexedAttestationStub: any,
    getBeaconProposerIndexStub: any, getCrossLinkComitteeStub: any;

  beforeEach(() => {
    attestationSlotStub = sandbox.stub(utils, "getAttestationDataSlot");
    currentEpochStub = sandbox.stub(utils, "getCurrentEpoch");
    previousEpochStub = sandbox.stub(utils, "getPreviousEpoch");
    getCrossLinkComitteeStub = sandbox.stub(utils, "getCrosslinkCommittee");
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
    attestationSlotStub.returns(0);
    expect(() => processAttestation(config, state, attestation)).to.throw;
  });

  it("fail to process attestation - future epoch", function () {
    const state = generateState({slot: 0});
    const attestation = generateEmptyAttestation();
    attestationSlotStub.returns(config.params.SLOTS_PER_EPOCH + 1);
    expect(() => processAttestation(config, state, attestation)).to.throw;
  });

  it("fail to process attestation - crosslink not zerohash", function () {
    const state = generateState({slot: 0});
    const attestation = generateEmptyAttestation();
    attestation.data.crosslink.dataRoot = Buffer.alloc(32, 1);
    attestationSlotStub.returns(config.params.SLOTS_PER_EPOCH + 1);
    expect(() => processAttestation(config, state, attestation)).to.throw;
  });

  it("should process attestation - currentEpoch === data.targetEpoch", function () {
    const state = generateState({
      slot: config.params.MIN_ATTESTATION_INCLUSION_DELAY + 1,
      currentJustifiedCheckpoint: {epoch: 1, root: ZERO_HASH}
    });
    currentEpochStub.returns(1);
    previousEpochStub.returns(0);
    validateIndexedAttestationStub.returns(true);
    getBeaconProposerIndexStub.returns(2);
    const attestation = generateEmptyAttestation();
    attestation.data.target.epoch = 1;
    attestation.data.source.epoch = 1;
    attestation.data.source.root = state.currentJustifiedCheckpoint.root;
    attestation.data.crosslink.parentRoot =
            hashTreeRoot(state.currentCrosslinks[attestation.data.crosslink.shard], config.types.Crosslink);
    attestation.data.crosslink.endEpoch = 1;
    attestationSlotStub.returns(1);
    getCrossLinkComitteeStub.returns(Array.from({length: attestation.aggregationBits.bitLength}));
    expect(processAttestation(config, state, attestation)).to.not.throw;
    expect(state.currentEpochAttestations.length).to.be.equal(1);
    expect(state.previousEpochAttestations.length).to.be.equal(0);
  });

  it("should process attestation - previousEpoch === data.targetEpoch", function () {
    const state = generateState({
      slot: config.params.MIN_ATTESTATION_INCLUSION_DELAY + 1,
      currentJustifiedCheckpoint: {epoch: 1, root: ZERO_HASH}
    });
    currentEpochStub.returns(1);
    previousEpochStub.returns(0);
    validateIndexedAttestationStub.returns(true);
    getBeaconProposerIndexStub.returns(2);
    const attestation = generateEmptyAttestation();
    attestation.data.target.epoch = 0;
    attestation.data.source.epoch = 0;
    attestation.data.source.root = state.previousJustifiedCheckpoint.root;
    attestation.data.crosslink.parentRoot =
            hashTreeRoot(state.currentCrosslinks[attestation.data.crosslink.shard], config.types.Crosslink);
    attestationSlotStub.returns(1);
    getCrossLinkComitteeStub.returns(Array.from({length: attestation.aggregationBits.bitLength}));
    expect(processAttestation(config, state, attestation)).to.not.throw;
    expect(state.currentEpochAttestations.length).to.be.equal(0);
    expect(state.previousEpochAttestations.length).to.be.equal(1);
  });

});
