import sinon, {SinonStub, SinonStubbedInstance} from "sinon";
import {expect} from "chai";

import {List} from "@chainsafe/ssz";
import {PrivateKey, PublicKey} from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import * as validatorUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validator";
import {EpochContext, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import * as blockUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";

import {BeaconChain, IAttestationJob, IBeaconChain} from "../../../../../src/chain";
import {LocalClock} from "../../../../../src/chain/clock";
import {IStateRegenerator, StateRegenerator} from "../../../../../src/chain/regen";
import {validateGossipAggregateAndProof} from "../../../../../src/network/gossip/validation";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../../../src/constants";
import * as validationUtils from "../../../../../src/network/gossip/validation/utils";
import {generateSignedAggregateAndProof} from "../../../../utils/aggregateAndProof";
import {generateState} from "../../../../utils/state";
import {silentLogger} from "../../../../utils/logger";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {AttestationErrorCode} from "../../../../../src/chain/errors";

describe("gossip aggregate and proof test", function () {
  const logger = silentLogger;
  let chain: SinonStubbedInstance<IBeaconChain>;
  let regen: SinonStubbedInstance<IStateRegenerator>;
  let db: StubbedBeaconDb;
  let isAggregatorStub: SinonStub;
  let isValidSelectionProofStub: SinonStub;
  let isValidSignatureStub: SinonStub;
  let isValidIndexedAttestationStub: SinonStub;

  beforeEach(async function () {
    chain = sinon.createStubInstance(BeaconChain);
    db = new StubbedBeaconDb(sinon);
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    chain.clock = sinon.createStubInstance(LocalClock);
    sinon.stub(chain.clock, "currentSlot").get(() => 0);
    regen = chain.regen = sinon.createStubInstance(StateRegenerator);
    db.badBlock.has.resolves(false);
    db.seenAttestationCache.hasAggregateAndProof.resolves(false);
    isAggregatorStub = sinon.stub(validatorUtils, "isAggregatorFromCommitteeLength");
    isValidSelectionProofStub = sinon.stub(validationUtils, "isValidSelectionProofSignature");
    isValidSignatureStub = sinon.stub(validationUtils, "isValidAggregateAndProofSignature");
    isValidIndexedAttestationStub = sinon.stub(blockUtils, "isValidIndexedAttestation");
  });

  afterEach(function () {
    isAggregatorStub.restore();
    isValidSelectionProofStub.restore();
    isValidSignatureStub.restore();
    isValidIndexedAttestationStub.restore();
  });

  it("should throw error - invalid slot (too old)", async function () {
    //move genesis time in past so current slot is high
    chain.getGenesisTime.returns(
      Math.floor(Date.now() / 1000) - (ATTESTATION_PROPAGATION_SLOT_RANGE + 1) * config.params.SECONDS_PER_SLOT
    );
    sinon
      .stub(chain.clock, "currentSlot")
      .get(() =>
        getCurrentSlot(
          config,
          Math.floor(Date.now() / 1000) - (ATTESTATION_PROPAGATION_SLOT_RANGE + 1) * config.params.SECONDS_PER_SLOT
        )
      );
    const item = generateSignedAggregateAndProof({
      aggregate: {
        data: {
          slot: 0,
        },
      },
    });
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_INVALID_SLOT_TIME);
    }
  });

  it("should throw error - invalid slot (too eager)", async function () {
    // move genesis time so slot 0 has not yet come
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000) + MAXIMUM_GOSSIP_CLOCK_DISPARITY + 1);
    sinon
      .stub(chain.clock, "currentSlot")
      .get(() => getCurrentSlot(config, Math.floor(Date.now() / 1000) + MAXIMUM_GOSSIP_CLOCK_DISPARITY + 1));
    const item = generateSignedAggregateAndProof({
      aggregate: {
        data: {
          slot: 0,
        },
      },
    });
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_INVALID_SLOT_TIME);
    }
  });

  it("should throw error - already seen", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        data: {
          slot: 0,
        },
      },
    });
    db.seenAttestationCache.hasAggregateAndProof.resolves(true);
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_AGGREGATE_ALREADY_KNOWN);
    }
    expect(db.seenAttestationCache.hasAggregateAndProof.withArgs(item.message).calledOnce).to.be.true;
  });

  it("should throw error - no attestation participants", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([false]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS);
    }
  });

  it("should throw error - attesting to invalid block", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    db.badBlock.has.resolves(true);
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_KNOWN_BAD_BLOCK);
    }
    expect(db.badBlock.has.withArgs(item.message.aggregate.data.beaconBlockRoot.valueOf() as Uint8Array).calledOnce).to
      .be.true;
  });

  it("should throw error - missing attestation prestate", async function () {
    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    regen.getBlockSlotState.throws();
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE);
    }
    expect(regen.getBlockSlotState.withArgs(item.message.aggregate.data.target.root, sinon.match.any).calledOnce).to.be
      .true;
  });

  it("should throw error - aggregator not in committee", async function () {
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
    regen.getBlockSlotState.resolves({
      state,
      epochCtx: (epochCtx as unknown) as EpochContext,
    });
    epochCtx.getBeaconCommittee.returns([]);
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE);
    }
    expect(
      epochCtx.getBeaconCommittee.withArgs(item.message.aggregate.data.slot, item.message.aggregate.data.index)
        .calledOnce
    ).to.be.true;
  });

  it("should throw error - not aggregator", async function () {
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
    regen.getBlockSlotState.resolves({
      state,
      epochCtx: (epochCtx as unknown) as EpochContext,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(false);
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_INVALID_AGGREGATOR);
    }
    expect(isAggregatorStub.withArgs(config, 1, item.message.selectionProof).calledOnce).to.be.true;
  });

  it("should throw error - invalid selection proof signature", async function () {
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
    regen.getBlockSlotState.resolves({
      state,
      epochCtx: (epochCtx as unknown) as EpochContext,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(true);
    isValidSelectionProofStub.returns(false);
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_INVALID_SELECTION_PROOF);
    }
    expect(isValidSelectionProofStub.calledOnce).to.be.true;
  });

  it("should throw error - invalid signature", async function () {
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
    regen.getBlockSlotState.resolves({
      state,
      epochCtx: (epochCtx as unknown) as EpochContext,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(true);
    isValidSelectionProofStub.returns(true);
    isValidSignatureStub.returns(false);
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_INVALID_SIGNATURE);
    }
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

  it("should throw error - invalid indexed attestation", async function () {
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
    regen.getBlockSlotState.resolves({
      state,
      epochCtx: (epochCtx as unknown) as EpochContext,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(true);
    isValidSelectionProofStub.returns(true);
    isValidSignatureStub.returns(true);
    isValidIndexedAttestationStub.returns(false);
    try {
      await validateGossipAggregateAndProof(config, chain, db, logger, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect(error.type).to.have.property("code", AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION);
    }
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
    regen.getBlockSlotState.resolves({
      state,
      epochCtx: (epochCtx as unknown) as EpochContext,
    });
    epochCtx.getBeaconCommittee.returns([item.message.aggregatorIndex]);
    isAggregatorStub.returns(true);
    isValidSelectionProofStub.returns(true);
    isValidSignatureStub.returns(true);
    isValidIndexedAttestationStub.returns(true);
    const validationTest = await validateGossipAggregateAndProof(config, chain, db, logger, item, {
      attestation: item.message.aggregate,
      validSignature: false,
    } as IAttestationJob);
    expect(validationTest).to.not.throw;
  });
});
