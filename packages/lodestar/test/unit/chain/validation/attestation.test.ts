import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, ChainEventEmitter, ForkChoiceStore, IBeaconChain} from "../../../../src/chain";
import {StubbedBeaconDb} from "../../../utils/stub";
import {expect} from "chai";

import {config} from "@chainsafe/lodestar-config/default";
import {phase0, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/allForks/util/attestation";
import * as blockUtils from "@chainsafe/lodestar-beacon-state-transition/lib/allForks/block/isValidIndexedAttestation";
import {BitList, toHexString} from "@chainsafe/ssz";
import {ProtoArray} from "@chainsafe/lodestar-fork-choice";
import {ForkChoice, IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IStateRegenerator, StateRegenerator} from "../../../../src/chain/regen";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../../../src/constants";
import {validateGossipAttestation} from "../../../../src/chain/validation";
import {generateAttestation} from "../../../utils/attestation";
import {generateCachedState} from "../../../utils/state";
import {LocalClock} from "../../../../src/chain/clock";
import {AttestationErrorCode} from "../../../../src/chain/errors";
import {Gwei} from "@chainsafe/lodestar-types";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {SinonStubFn} from "../../../utils/types";
import {expectRejectedWithLodestarError} from "../../../utils/errors";

describe("gossip attestation validation", function () {
  let chain: SinonStubbedInstance<IBeaconChain>;
  let forkChoice: SinonStubbedInstance<IForkChoice>;
  let regen: SinonStubbedInstance<IStateRegenerator>;
  let db: StubbedBeaconDb;
  let computeAttestationSubnetStub: SinonStubFn<typeof attestationUtils["computeSubnetForAttestation"]>;
  let isValidIndexedAttestationStub: SinonStubFn<typeof blockUtils["isValidIndexedAttestation"]>;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let toIndexedAttestation: (attestation: phase0.Attestation) => phase0.IndexedAttestation;

  beforeEach(function () {
    chain = sinon.createStubInstance(BeaconChain);
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    chain.clock = sinon.createStubInstance(LocalClock);
    sinon.stub(chain.clock, "currentSlot").get(() => 0);
    forkChoice = chain.forkChoice = sinon.createStubInstance(ForkChoice);
    regen = chain.regen = sinon.createStubInstance(StateRegenerator);
    chain.bls = {verifySignatureSets: async () => true};
    db = new StubbedBeaconDb(sinon, config);
    computeAttestationSubnetStub = sinon.stub(attestationUtils, "computeSubnetForAttestation");
    isValidIndexedAttestationStub = sinon.stub(blockUtils, "isValidIndexedAttestation");
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
    toIndexedAttestation = (attestation: phase0.Attestation) =>
      ({
        attestingIndices: Object.entries(attestation.aggregationBits).map((value) => (value ? 1 : 0)),
        data: attestation.data,
        signature: attestation.signature,
      } as phase0.IndexedAttestation);
  });

  afterEach(function () {
    computeAttestationSubnetStub.restore();
    isValidIndexedAttestationStub.restore();
  });

  it("should throw error - attestation has empty aggregation bits", async function () {
    const attestation = generateAttestation({aggregationBits: ([] as boolean[]) as BitList});

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET
    );
  });

  it("should throw error - attestation has more aggregation bits", async function () {
    const attestation = generateAttestation({aggregationBits: [true, true] as BitList});

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET
    );
  });

  it("should throw error - old attestation", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        slot: getCurrentSlot(config, chain.getGenesisTime()) - ATTESTATION_PROPAGATION_SLOT_RANGE - 1,
      },
    });

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.PAST_SLOT
    );
  });

  it("should throw error - future attestation", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        slot: getCurrentSlot(config, chain.getGenesisTime()) + 5,
      },
    });

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.FUTURE_SLOT
    );
  });

  it("should throw error - validator already attested to target epoch", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(true);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.ATTESTATION_ALREADY_KNOWN
    );

    expect(chain.receiveAttestation.called).to.be.false;
    expect(db.seenAttestationCache.hasCommitteeAttestation.calledOnceWith(attestation)).to.be.true;
  });

  it("should throw error - missing attestation block", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(false);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT
    );

    expect(forkChoice.hasBlock.calledOnceWith(attestation.data.beaconBlockRoot)).to.be.true;
  });

  it("should throw error - missing attestation pre state context", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(true);
    regen.getCheckpointState.throws();

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE
    );

    expect(regen.getCheckpointState.calledOnceWith(attestation.data.target)).to.be.true;
  });

  it("should throw error - attestation on wrong subnet", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(true);
    const attestationTargetState = generateCachedState();
    regen.getCheckpointState.resolves(attestationTargetState);
    computeAttestationSubnetStub.returns(5);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.INVALID_SUBNET_ID
    );

    expect(chain.receiveAttestation.called).to.be.false;
    expect(computeAttestationSubnetStub.calledOnceWith(attestationTargetState, attestation)).to.be.true;
  });

  it("should throw error - invalid indexed attestation", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(true);
    const attestationTargetState = generateCachedState();
    attestationTargetState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationTargetState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(false);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.INVALID_INDEXED_ATTESTATION
    );

    expect(chain.receiveAttestation.called).to.be.false;
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should throw error - committee index not within the expected range", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        index: 999999999,
      },
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(true);
    const attestationTargetState = generateCachedState();
    attestationTargetState.epochCtx.previousShuffling = {
      epoch: 0,
    } as allForks.IEpochShuffling;
    attestationTargetState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationTargetState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE
    );

    expect(chain.receiveAttestation.called).to.be.false;
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should throw error - crosslink committee retrieval: out of range epoch", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        index: 999999999,
      },
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(true);
    const attestationTargetState = generateCachedState();
    attestationTargetState.epochCtx.previousShuffling = {
      epoch: 10,
    } as allForks.IEpochShuffling;
    attestationTargetState.epochCtx.currentShuffling = {
      epoch: 10,
    } as allForks.IEpochShuffling;
    attestationTargetState.epochCtx.nextShuffling = {
      epoch: 10,
    } as allForks.IEpochShuffling;
    attestationTargetState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationTargetState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE
    );

    expect(chain.receiveAttestation.called).to.be.false;
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should throw error - number of aggregation bits does not match the committee size", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(true);
    const attestationTargetState = generateCachedState();
    attestationTargetState.epochCtx.previousShuffling = {
      epoch: 0,
      committees: [[[]]],
      activeIndices: [],
      shuffling: [],
      committeesPerSlot: 1,
    };
    attestationTargetState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationTargetState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS
    );

    expect(chain.receiveAttestation.called).to.be.false;
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should throw error - epoch slot does not match target", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        slot: 0,
        target: {
          epoch: 12,
        },
      },
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(true);
    const attestationTargetState = generateCachedState();
    attestationTargetState.epochCtx.previousShuffling = {
      epoch: 0,
    } as allForks.IEpochShuffling;
    attestationTargetState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationTargetState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.BAD_TARGET_EPOCH
    );
  });

  it("should throw error - target block is not an ancestor of the block named in the LMD vote", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        target: {
          root: Buffer.alloc(32, "thisisbad"),
        },
      },
    });
    chain.forkChoice = new ForkChoice({
      config,
      fcStore: new ForkChoiceStore({
        emitter: new ChainEventEmitter(),
        currentSlot: 0,
        justifiedCheckpoint: {
          epoch: 0,
          root: Buffer.alloc(32),
        },
        finalizedCheckpoint: {
          epoch: 0,
          root: Buffer.alloc(32),
        },
      }),
      protoArray: ProtoArray.initialize({
        slot: 0,
        parentRoot: toHexString(Buffer.alloc(32)),
        stateRoot: toHexString(Buffer.alloc(32)),
        blockRoot: toHexString(Buffer.alloc(32)),
        justifiedEpoch: 0,
        finalizedEpoch: 0,
      }),
      queuedAttestations: new Set(),
      justifiedBalances: [] as Gwei[],
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(true);
    const attestationTargetState = generateCachedState();
    attestationTargetState.epochCtx.previousShuffling = {
      activeIndices: [],
      epoch: 0,
      committees: [[[1]]],
      shuffling: [],
      committeesPerSlot: 1,
    } as allForks.IEpochShuffling;
    attestationTargetState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationTargetState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK
    );
  });

  it("should throw error - current finalized_checkpoint not is an ancestor of the block defined by attestation.data.beacon_block_root", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        beaconBlockRoot: Buffer.alloc(32),
      },
    });
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoice.hasBlock.returns(true);
    forkChoice.isDescendant.returns(true);
    forkChoice.isDescendantOfFinalized.returns(false);
    const attestationTargetState = generateCachedState();
    attestationTargetState.epochCtx.previousShuffling = {
      activeIndices: [],
      epoch: 0,
      committees: [[[1]]],
      shuffling: [],
      committeesPerSlot: 1,
    } as allForks.IEpochShuffling;
    attestationTargetState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationTargetState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);

    await expectRejectedWithLodestarError(
      validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0),
      AttestationErrorCode.FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT
    );
  });

  it("should accept", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    const attestationTargetState = generateCachedState();
    attestationTargetState.epochCtx.previousShuffling = {
      activeIndices: [],
      epoch: 0,
      committees: [[[1]]],
      shuffling: [],
      committeesPerSlot: 1,
    } as allForks.IEpochShuffling;
    attestationTargetState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationTargetState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);
    chain.getFinalizedCheckpoint.returns({epoch: 0, root: Buffer.alloc(32)});
    chain.forkChoice = forkChoiceStub;
    forkChoiceStub.getFinalizedCheckpoint.returns({epoch: 0, root: Buffer.alloc(32)});
    forkChoiceStub.getAncestor.returns(Buffer.alloc(32));
    db.seenAttestationCache.hasCommitteeAttestation.returns(false);
    forkChoiceStub.hasBlock.returns(true);
    forkChoiceStub.isDescendant.returns(true);
    forkChoiceStub.isDescendantOfFinalized.returns(true);

    const validationTest = await validateGossipAttestation(config, chain, db, {attestation, validSignature: false}, 0);

    expect(validationTest).to.not.throw;
    expect(chain.receiveAttestation.called).to.be.false;
    expect(db.seenAttestationCache.addCommitteeAttestation.calledOnce).to.be.true;
  });
});
