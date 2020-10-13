import sinon, {createStubInstance, SinonStub, SinonStubbedInstance} from "sinon";
import {BeaconChain, ChainEventEmitter, ForkChoiceStore, IBeaconChain} from "../../../../../src/chain";
import {StubbedBeaconDb} from "../../../../utils/stub";
import {expect} from "chai";

import {Attestation, IndexedAttestation} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {EpochContext, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/attestation";
import * as blockUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {BitList, toHexString} from "@chainsafe/ssz";
import {ProtoArray} from "@chainsafe/lodestar-fork-choice";
import {ForkChoice, IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {IStateRegenerator, StateRegenerator} from "../../../../../src/chain/regen";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../../../../src/constants";
import {validateGossipAttestation} from "../../../../../src/network/gossip/validation";
import {ExtendedValidatorResult} from "../../../../../src/network/gossip/constants";
import {generateAttestation} from "../../../../utils/attestation";
import {silentLogger} from "../../../../utils/logger";
import {generateState} from "../../../../utils/state";
import {LocalClock} from "../../../../../src/chain/clock";
import {IEpochShuffling} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/epochShuffling";

describe("gossip attestation validation", function () {
  const logger = silentLogger;
  let chain: SinonStubbedInstance<IBeaconChain>;
  let forkChoice: SinonStubbedInstance<IForkChoice>;
  let regen: SinonStubbedInstance<IStateRegenerator>;
  let db: StubbedBeaconDb;
  let computeAttestationSubnetStub: SinonStub;
  let isValidIndexedAttestationStub: SinonStub;
  let forkChoiceStub: SinonStubbedInstance<ForkChoice>;
  let toIndexedAttestation: Function;

  beforeEach(function () {
    chain = sinon.createStubInstance(BeaconChain);
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    chain.clock = createStubInstance(LocalClock);
    sinon.stub(chain.clock, "currentSlot").get(() => 0);
    forkChoice = chain.forkChoice = createStubInstance(ForkChoice);
    regen = chain.regen = createStubInstance(StateRegenerator);
    db = new StubbedBeaconDb(sinon, config);
    db.badBlock.has.resolves(false);
    computeAttestationSubnetStub = sinon.stub(attestationUtils, "computeSubnetForAttestation");
    isValidIndexedAttestationStub = sinon.stub(blockUtils, "isValidIndexedAttestation");
    forkChoiceStub = sinon.createStubInstance(ForkChoice);
    toIndexedAttestation = (attestation: Attestation) =>
      ({
        attestingIndices: Object.entries(attestation.aggregationBits).map((value) => (value ? 1 : 0)),
        data: attestation.data,
        signature: attestation.signature,
      } as IndexedAttestation);
  });

  afterEach(function () {
    computeAttestationSubnetStub.restore();
    isValidIndexedAttestationStub.restore();
  });

  it("should reject - attestation has empty aggregation bits", async function () {
    const attestation = generateAttestation({aggregationBits: ([] as boolean[]) as BitList});
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
  });

  it("should reject - attestation has more aggregation bits", async function () {
    const attestation = generateAttestation({aggregationBits: [true, true] as BitList});
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
  });

  it("should reject - attestation block is invalid", async function () {
    const attestation = generateAttestation({aggregationBits: [true] as BitList});
    db.badBlock.has.resolves(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(db.badBlock.has.calledOnceWith(attestation.data.beaconBlockRoot.valueOf() as Uint8Array)).to.be.true;
  });

  it("should ignore - old attestation", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        slot: getCurrentSlot(config, chain.getGenesisTime()) - ATTESTATION_PROPAGATION_SLOT_RANGE - 1,
      },
    });
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chain.receiveAttestation.calledOnceWith(attestation)).to.be.true;
  });

  it("should ignore - future attestation", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        slot: getCurrentSlot(config, chain.getGenesisTime()) + 5,
      },
    });
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chain.receiveAttestation.calledOnceWith(attestation)).to.be.true;
  });

  it("should ignore - validator already attested to target epoch", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(db.seenAttestationCache.hasCommitteeAttestation.calledOnceWith(attestation)).to.be.true;
  });

  it("should ignore - validator already attested to target epoch", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(db.seenAttestationCache.hasCommitteeAttestation.calledOnceWith(attestation)).to.be.true;
  });

  it("should ignore - missing attestation block", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(false);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chain.receiveAttestation.called).to.be.true;
    expect(forkChoice.hasBlock.calledOnceWith(attestation.data.beaconBlockRoot)).to.be.true;
  });

  it("should ignore - missing attestation pre state context", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    regen.getCheckpointState.throws();
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chain.receiveAttestation.called).to.be.true;
    expect(regen.getCheckpointState.calledOnceWith(attestation.data.target)).to.be.true;
  });

  it("should reject - attestation on wrong subnet", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    const attestationPreState = {
      state: generateState(),
      epochCtx: new EpochContext(config),
    };
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(5);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(computeAttestationSubnetStub.calledOnceWith(config, attestationPreState.epochCtx, attestation)).to.be.true;
  });

  it("should reject - invalid indexed attestation", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    const attestationPreState = {
      state: generateState(),
      epochCtx: new EpochContext(config),
    };
    attestationPreState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(false);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should reject - committee index not within the expected range", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        index: 999999999,
      },
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    const attestationPreState = {
      state: generateState(),
      epochCtx: new EpochContext(config),
    };
    attestationPreState.epochCtx.previousShuffling = {
      epoch: 0,
    } as IEpochShuffling;
    attestationPreState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should reject - crosslink committee retrieval: out of range epoch", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        index: 999999999,
      },
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    const attestationPreState = {
      state: generateState(),
      epochCtx: new EpochContext(config),
    };
    attestationPreState.epochCtx.previousShuffling = {
      epoch: 10,
    } as IEpochShuffling;
    attestationPreState.epochCtx.currentShuffling = {
      epoch: 10,
    } as IEpochShuffling;
    attestationPreState.epochCtx.nextShuffling = {
      epoch: 10,
    } as IEpochShuffling;
    attestationPreState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should reject - number of aggregation bits does not match the committee size", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    const attestationPreState = {
      state: generateState(),
      epochCtx: new EpochContext(config),
    };
    attestationPreState.epochCtx.previousShuffling = {
      epoch: 0,
    } as IEpochShuffling;
    attestationPreState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should reject - epoch slot does not match target", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        slot: 0,
        target: {
          epoch: 12,
        },
      },
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    const attestationPreState = {
      state: generateState(),
      epochCtx: new EpochContext(config),
    };
    attestationPreState.epochCtx.previousShuffling = {
      epoch: 0,
    } as IEpochShuffling;
    attestationPreState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
  });

  it("should reject - target block is not an ancestor of the block named in the LMD vote", async function () {
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
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    const attestationPreState = {
      state: generateState(),
      epochCtx: new EpochContext(config),
    };
    attestationPreState.epochCtx.previousShuffling = {
      activeIndices: [],
      epoch: 0,
      committees: [[[1]]],
    } as any;
    attestationPreState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
  });

  it("should reject - current finalized_checkpoint not is an ancestor of the block defined by attestation.data.beacon_block_root", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
      data: {
        beaconBlockRoot: Buffer.alloc(32),
      },
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    forkChoice.isDescendant.returns(true);
    forkChoice.isDescendantOfFinalized.returns(false);
    const attestationPreState = {
      state: generateState(),
      epochCtx: new EpochContext(config),
    };
    attestationPreState.epochCtx.previousShuffling = {
      activeIndices: [],
      epoch: 0,
      committees: [[[1]]],
    } as any;
    attestationPreState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
  });

  it("should accept", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    const state = generateState();
    const attestationPreState = {
      state,
      epochCtx: new EpochContext(config),
    };
    attestationPreState.epochCtx.previousShuffling = {
      activeIndices: [],
      epoch: 0,
      committees: [[[1]]],
    } as any;
    attestationPreState.epochCtx.getIndexedAttestation = () => toIndexedAttestation(attestation);
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);
    chain.getFinalizedCheckpoint.resolves({epoch: 0, root: Buffer.alloc(32)});
    chain.forkChoice = forkChoiceStub;
    forkChoiceStub.getFinalizedCheckpoint.returns({epoch: 0, root: Buffer.alloc(32)});
    forkChoiceStub.getAncestor.returns(Buffer.alloc(32));
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoiceStub.hasBlock.returns(true);
    forkChoiceStub.isDescendant.returns(true);
    forkChoiceStub.isDescendantOfFinalized.returns(true);
    const result = await validateGossipAttestation(config, chain, db, logger, {attestation, validSignature: false}, 0);
    expect(result).to.equal(ExtendedValidatorResult.accept);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(db.seenAttestationCache.addCommitteeAttestation.calledOnce).to.be.true;
  });
});
