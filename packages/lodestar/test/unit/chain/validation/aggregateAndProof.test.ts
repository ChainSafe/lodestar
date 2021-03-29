import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {rewiremock} from "../../../rewiremock";

import {List} from "@chainsafe/ssz";
import bls from "@chainsafe/bls";
import {bigIntToBytes} from "@chainsafe/lodestar-utils";
import {config} from "@chainsafe/lodestar-config/minimal";
import * as validatorUtils from "@chainsafe/lodestar-beacon-state-transition/lib/util/validator";
import {getCurrentSlot, ISignatureSet} from "@chainsafe/lodestar-beacon-state-transition";
import * as indexedAttUtils from "@chainsafe/lodestar-beacon-state-transition/lib/phase0/fast/block/isValidIndexedAttestation";

import {BeaconChain, IAttestationJob, IBeaconChain} from "../../../../src/chain";
import {LocalClock} from "../../../../src/chain/clock";
import {IStateRegenerator, StateRegenerator} from "../../../../src/chain/regen";
import {validateGossipAggregateAndProof} from "../../../../src/chain/validation";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../../src/constants";
import * as blsUtils from "../../../../src/chain/bls";
import {generateSignedAggregateAndProof} from "../../../utils/aggregateAndProof";
import {generateCachedState} from "../../../utils/state";
import {StubbedBeaconDb} from "../../../utils/stub";
import {AttestationErrorCode} from "../../../../src/chain/errors";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {SinonStubFn} from "../../../utils/types";
import {AttestationError} from "../../../../src/chain/errors";

describe("gossip aggregate and proof test", function () {
  let chain: SinonStubbedInstance<IBeaconChain>;
  let regen: SinonStubbedInstance<IStateRegenerator>;
  let db: StubbedBeaconDb;
  let isAggregatorStub: SinonStubFn<typeof validatorUtils["isAggregatorFromCommitteeLength"]>;
  let isValidIndexedAttestationStub: SinonStubFn<typeof indexedAttUtils["isValidIndexedAttestation"]>;
  // This util it not relevant for testing since only the result of verifySignatureSetsBatch() matters
  const getIndexedAttestationSignatureSet: typeof indexedAttUtils["getIndexedAttestationSignatureSet"] = () =>
    ({} as ISignatureSet);

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function mockValidateGossipAggregateAndProof({
    isAggregatorFromCommitteeLength,
    isValidIndexedAttestation,
    verifySignatureSetsBatch,
  }: {
    isAggregatorFromCommitteeLength: typeof validatorUtils.isAggregatorFromCommitteeLength;
    isValidIndexedAttestation: typeof indexedAttUtils.isValidIndexedAttestation;
    verifySignatureSetsBatch: typeof blsUtils.verifySignatureSetsBatch;
  }) {
    return await rewiremock.around(
      () => import("../../../../src/chain/validation"),
      (mock) => {
        mock(() => import("@chainsafe/lodestar-beacon-state-transition/lib/util/validator"))
          .with({isAggregatorFromCommitteeLength})
          .toBeUsed();
        mock(() =>
          import("@chainsafe/lodestar-beacon-state-transition/lib/phase0/fast/block/isValidIndexedAttestation")
        )
          .with({isValidIndexedAttestation, getIndexedAttestationSignatureSet})
          .toBeUsed();
        mock(() => import("../../../../src/chain/bls"))
          .with({verifySignatureSetsBatch})
          .toBeUsed();
      }
    );
  }

  beforeEach(function () {
    chain = sinon.createStubInstance(BeaconChain);
    db = new StubbedBeaconDb(sinon);
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    chain.clock = sinon.createStubInstance(LocalClock);
    sinon.stub(chain.clock, "currentSlot").get(() => 0);
    regen = chain.regen = sinon.createStubInstance(StateRegenerator);
    db.badBlock.has.resolves(false);
    db.seenAttestationCache.hasAggregateAndProof.returns(false);
    isAggregatorStub = sinon.stub(validatorUtils, "isAggregatorFromCommitteeLength");
    isValidIndexedAttestationStub = sinon.stub(indexedAttUtils, "isValidIndexedAttestation");
  });

  afterEach(function () {
    isAggregatorStub.restore();
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
      await validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect((error as AttestationError).type).to.have.property("code", AttestationErrorCode.PAST_SLOT);
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
      await validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect((error as AttestationError).type).to.have.property("code", AttestationErrorCode.FUTURE_SLOT);
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
    db.seenAttestationCache.hasAggregateAndProof.returns(true);
    try {
      await validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect((error as AttestationError).type).to.have.property("code", AttestationErrorCode.AGGREGATE_ALREADY_KNOWN);
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
      await validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect((error as AttestationError).type).to.have.property(
        "code",
        AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS
      );
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
      await validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect((error as AttestationError).type).to.have.property("code", AttestationErrorCode.KNOWN_BAD_BLOCK);
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
    regen.getCheckpointState.throws();
    try {
      await validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect((error as AttestationError).type).to.have.property(
        "code",
        AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE
      );
    }
    expect(regen.getCheckpointState.withArgs(item.message.aggregate.data.target).calledOnce).to.be.true;
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
    const state = generateCachedState();
    sinon.stub(state.epochCtx, "getBeaconCommittee").returns([]);
    regen.getCheckpointState.resolves(state);
    try {
      await validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect((error as AttestationError).type).to.have.property(
        "code",
        AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE
      );
    }
    expect(
      (state.getBeaconCommittee as SinonStubFn<typeof state["getBeaconCommittee"]>).withArgs(
        item.message.aggregate.data.slot,
        item.message.aggregate.data.index
      ).calledOnce
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
    const state = generateCachedState();
    sinon.stub(state.epochCtx, "getBeaconCommittee").returns([item.message.aggregatorIndex]);
    regen.getCheckpointState.resolves(state);
    isAggregatorStub.returns(false);
    try {
      await validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob);
    } catch (error) {
      expect((error as AttestationError).type).to.have.property("code", AttestationErrorCode.INVALID_AGGREGATOR);
    }
    expect(isAggregatorStub.withArgs(config, 1, item.message.selectionProof).calledOnce).to.be.true;
  });

  it("should throw error - invalid selection proof signature", async function () {
    const {validateGossipAggregateAndProof} = await mockValidateGossipAggregateAndProof({
      isAggregatorFromCommitteeLength: sinon.stub().returns(true),
      isValidIndexedAttestation: sinon.stub().returns(true),
      verifySignatureSetsBatch: sinon.stub().returns(false),
    });

    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateCachedState();
    const privateKey = bls.SecretKey.fromBytes(bigIntToBytes(BigInt(1), 32));
    state.index2pubkey[item.message.aggregatorIndex] = privateKey.toPublicKey();
    sinon.stub(state.epochCtx, "getBeaconCommittee").returns([item.message.aggregatorIndex]);
    regen.getCheckpointState.resolves(state);

    await expectRejectedWithLodestarError(
      validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob),
      AttestationErrorCode.INVALID_SIGNATURE
    );
  });

  it("should throw error - invalid signature", async function () {
    const {validateGossipAggregateAndProof} = await mockValidateGossipAggregateAndProof({
      isAggregatorFromCommitteeLength: sinon.stub().returns(true),
      isValidIndexedAttestation: sinon.stub().returns(true),
      verifySignatureSetsBatch: sinon.stub().returns(false),
    });

    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateCachedState();
    const privateKey = bls.SecretKey.fromBytes(bigIntToBytes(BigInt(1), 32));
    state.index2pubkey[item.message.aggregatorIndex] = privateKey.toPublicKey();
    sinon.stub(state.epochCtx, "getBeaconCommittee").returns([item.message.aggregatorIndex]);
    regen.getCheckpointState.resolves(state);

    await expectRejectedWithLodestarError(
      validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob),
      AttestationErrorCode.INVALID_SIGNATURE
    );
  });

  it("should throw error - invalid indexed attestation", async function () {
    const {validateGossipAggregateAndProof} = await mockValidateGossipAggregateAndProof({
      isAggregatorFromCommitteeLength: sinon.stub().returns(true),
      isValidIndexedAttestation: sinon.stub().returns(false),
      verifySignatureSetsBatch: sinon.stub().returns(true),
    });

    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateCachedState();
    const privateKey = bls.SecretKey.fromBytes(bigIntToBytes(BigInt(1), 32));
    state.index2pubkey[item.message.aggregatorIndex] = privateKey.toPublicKey();
    sinon.stub(state.epochCtx, "getBeaconCommittee").returns([item.message.aggregatorIndex]);
    regen.getCheckpointState.resolves(state);

    await expectRejectedWithLodestarError(
      validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob),
      AttestationErrorCode.INVALID_INDEXED_ATTESTATION
    );
  });

  it("should accept", async function () {
    const {validateGossipAggregateAndProof} = await mockValidateGossipAggregateAndProof({
      isAggregatorFromCommitteeLength: sinon.stub().returns(true),
      isValidIndexedAttestation: sinon.stub().returns(true),
      verifySignatureSetsBatch: sinon.stub().returns(true),
    });

    const item = generateSignedAggregateAndProof({
      aggregate: {
        aggregationBits: Array.from([true]) as List<boolean>,
        data: {
          slot: 0,
        },
      },
    });
    const state = generateCachedState();
    const privateKey = bls.SecretKey.fromKeygen();
    state.index2pubkey[item.message.aggregatorIndex] = privateKey.toPublicKey();
    sinon.stub(state.epochCtx, "getBeaconCommittee").returns([item.message.aggregatorIndex]);
    regen.getCheckpointState.resolves(state);

    expect(
      await validateGossipAggregateAndProof(config, chain, db, item, {
        attestation: item.message.aggregate,
        validSignature: false,
      } as IAttestationJob)
    ).to.not.throw;
  });
});
