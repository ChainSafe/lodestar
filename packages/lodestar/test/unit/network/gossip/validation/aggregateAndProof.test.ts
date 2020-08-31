import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../../src/chain";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {validateGossipAggregateAndProof} from "../../../../../src/network/gossip/validation";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {generateSignedAggregateAndProof} from "../../../../utils/aggregateAndProof";
import {expect} from "chai";
import {ExtendedValidatorResult} from "../../../../../src/network/gossip/constants";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../../../src/constants";
import {List} from "@chainsafe/ssz";
import * as gossipUtils from "../../../../../src/network/gossip/utils";
import * as validatorUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validator";
import * as validationUtils from "../../../../../src/network/gossip/validation/utils";
import * as blockUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {generateState} from "../../../../utils/state";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import {PrivateKey, PublicKey} from "@chainsafe/bls";
import {silentLogger} from "../../../../utils/logger";

describe("gossip aggregate and proof test", function () {
  const logger = silentLogger;
  let chain: SinonStubbedInstance<IBeaconChain>;
  let db: StubbedBeaconDb;
  let getAttestationPreStateStub: SinonStub;
  let isAggregatorStub: SinonStub;
  let isValidSelectionProofStub: SinonStub;
  let isValidSignatureStub: SinonStub;
  let isValidIndexedAttestationStub: SinonStub;

  beforeEach(function () {
    chain = sinon.createStubInstance(BeaconChain);
    db = new StubbedBeaconDb(sinon);
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    db.badBlock.has.resolves(false);
    db.seenAttestationCache.hasAggregateAndProof.resolves(false);
    getAttestationPreStateStub = sinon.stub(gossipUtils, "getAttestationPreState");
    isAggregatorStub = sinon.stub(validatorUtils, "isAggregatorFromCommitteeLength");
    isValidSelectionProofStub = sinon.stub(validationUtils, "isValidSelectionProofSignature");
    isValidSignatureStub = sinon.stub(validationUtils, "isValidAggregateAndProofSignature");
    isValidIndexedAttestationStub = sinon.stub(blockUtils, "isValidIndexedAttestation");
  });

  afterEach(function () {
    getAttestationPreStateStub.restore();
    isAggregatorStub.restore();
    isValidSelectionProofStub.restore();
    isValidSignatureStub.restore();
    isValidIndexedAttestationStub.restore();
  });

  it("should ignore - invalid slot (too old)", async function () {
    //move genesis time in past so current slot is high
    chain.getGenesisTime.returns(
      Math.floor(Date.now() / 1000) - (ATTESTATION_PROPAGATION_SLOT_RANGE + 1) * config.params.SECONDS_PER_SLOT
    );
    const item = generateSignedAggregateAndProof({
      aggregate: {
        data: {
          slot: 0,
        },
      },
    });
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.ignore);
  });

  it("should ignore - invalid slot (too eager)", async function () {
    //move genesis time so slot 0 has not yet come
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000) + MAXIMUM_GOSSIP_CLOCK_DISPARITY + 1);
    const item = generateSignedAggregateAndProof({
      aggregate: {
        data: {
          slot: 0,
        },
      },
    });
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.ignore);
  });

  it("should ignore - already seen", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        data: {
          slot: 0,
        },
      },
    });
    db.seenAttestationCache.hasAggregateAndProof.resolves(true);
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.ignore);
    expect(db.seenAttestationCache.hasAggregateAndProof.withArgs(item.message).calledOnce).to.be.true;
  });

  it("should reject - no attestation participants", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([false]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.reject);
  });

  it("should reject - attesting to invalid block", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    db.badBlock.has.resolves(true);
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.reject);
    expect(db.badBlock.has.withArgs(item.message.aggregate.data.beaconBlockRoot.valueOf() as Uint8Array).calledOnce).to
      .be.true;
  });

  it("should ignore - missing attestation prestate", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    getAttestationPreStateStub.resolves(false);
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.ignore);
    expect(getAttestationPreStateStub.withArgs(config, chain, db, item.message.aggregate.data.target).calledOnce).to.be
      .true;
  });

  it("should reject - aggregator not in committee", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateState();
    const epochCtx = sinon.createStubInstance(EpochContext);
    getAttestationPreStateStub.resolves({
      state,
      epochCtx,
    });
    epochCtx.getBeaconCommittee.returns([]);
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.reject);
    expect(
      epochCtx.getBeaconCommittee.withArgs(item.message.aggregate.data.slot, item.message.aggregate.data.index)
        .calledOnce
    ).to.be.true;
  });

  it("should reject - not aggregator", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateState();
    const epochCtx = sinon.createStubInstance(EpochContext);
    getAttestationPreStateStub.resolves({
      state,
      epochCtx,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(false);
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.reject);
    expect(isAggregatorStub.withArgs(config, 1, item.message.selectionProof).calledOnce).to.be.true;
  });

  it("should reject - invalid selection proof signature", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateState();
    const epochCtx = sinon.createStubInstance(EpochContext);
    epochCtx.index2pubkey = [];
    epochCtx.index2pubkey[item.message.aggregatorIndex] = PublicKey.fromPrivateKey(PrivateKey.fromInt(1));
    getAttestationPreStateStub.resolves({
      state,
      epochCtx,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(true);
    isValidSelectionProofStub.returns(false);
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.reject);
    expect(
      isValidSelectionProofStub.withArgs(
        config,
        state,
        item.message.aggregate.data.slot,
        epochCtx.index2pubkey[item.message.aggregatorIndex],
        sinon.match.any
      ).calledOnce
    ).to.be.true;
  });

  it("should reject - invalid signature", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateState();
    const epochCtx = sinon.createStubInstance(EpochContext);
    epochCtx.index2pubkey = [];
    epochCtx.index2pubkey[item.message.aggregatorIndex] = PublicKey.fromPrivateKey(PrivateKey.fromInt(1));
    getAttestationPreStateStub.resolves({
      state,
      epochCtx,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(true);
    isValidSelectionProofStub.returns(true);
    isValidSignatureStub.returns(false);
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.reject);
    expect(
      isValidSignatureStub.withArgs(
        config,
        state,
        0,
        epochCtx.index2pubkey[item.message.aggregatorIndex],
        sinon.match.any
      ).calledOnce
    ).to.be.true;
  });

  it("should reject - invalid indexed attestation", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateState();
    const epochCtx = sinon.createStubInstance(EpochContext);
    epochCtx.index2pubkey = [];
    epochCtx.index2pubkey[item.message.aggregatorIndex] = PublicKey.fromPrivateKey(PrivateKey.fromInt(1));
    getAttestationPreStateStub.resolves({
      state,
      epochCtx,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(true);
    isValidSelectionProofStub.returns(true);
    isValidSignatureStub.returns(true);
    isValidIndexedAttestationStub.returns(false);
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.reject);
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should accept", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateState();
    const epochCtx = sinon.createStubInstance(EpochContext);
    epochCtx.index2pubkey = [];
    epochCtx.index2pubkey[item.message.aggregatorIndex] = PublicKey.fromPrivateKey(PrivateKey.fromInt(1));
    getAttestationPreStateStub.resolves({
      state,
      epochCtx,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(true);
    isValidSelectionProofStub.returns(true);
    isValidSignatureStub.returns(true);
    isValidIndexedAttestationStub.returns(true);
    const result = await validateGossipAggregateAndProof(config, chain, db, logger, item);
    expect(result).to.be.equal(ExtendedValidatorResult.accept);
  });
});
