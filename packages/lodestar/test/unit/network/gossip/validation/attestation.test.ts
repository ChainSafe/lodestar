import sinon, {createStubInstance, SinonStub, SinonStubbedInstance} from "sinon";
import {expect} from "chai";

import {BitList} from "@chainsafe/ssz";
import {IndexedAttestation} from "@chainsafe/lodestar-types";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {EpochContext, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/attestation";
import * as blockUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";
import {ForkChoice, IForkChoice} from "@chainsafe/lodestar-fork-choice";

import {BeaconChain, IBeaconChain} from "../../../../../src/chain";
import {IStateRegenerator, StateRegenerator} from "../../../../../src/chain/regen";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../../../../src/constants";
import {validateGossipAttestation} from "../../../../../src/network/gossip/validation";
import {ExtendedValidatorResult} from "../../../../../src/network/gossip/constants";
import {generateAttestation} from "../../../../utils/attestation";
import {silentLogger} from "../../../../utils/logger";
import {generateState} from "../../../../utils/state";
import {StubbedBeaconDb} from "../../../../utils/stub";

describe("gossip attestation validation", function () {
  const logger = silentLogger;
  let chain: SinonStubbedInstance<IBeaconChain>;
  let forkChoice: SinonStubbedInstance<IForkChoice>;
  let regen: SinonStubbedInstance<IStateRegenerator>;
  let db: StubbedBeaconDb;
  let computeAttestationSubnetStub: SinonStub;
  let isValidIndexedAttestationStub: SinonStub;

  beforeEach(function () {
    chain = sinon.createStubInstance(BeaconChain);
    chain.getGenesisTime.returns(Math.floor(Date.now() / 1000));
    forkChoice = chain.forkChoice = createStubInstance(ForkChoice);
    regen = chain.regen = createStubInstance(StateRegenerator);
    db = new StubbedBeaconDb(sinon, config);
    db.badBlock.has.resolves(false);
    computeAttestationSubnetStub = sinon.stub(attestationUtils, "computeSubnetForAttestation");
    isValidIndexedAttestationStub = sinon.stub(blockUtils, "isValidIndexedAttestation");
  });

  afterEach(function () {
    computeAttestationSubnetStub.restore();
    isValidIndexedAttestationStub.restore();
  });

  it("should reject - attestation has empty aggregation bits", async function () {
    const attestation = generateAttestation({aggregationBits: ([] as boolean[]) as BitList});
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
  });

  it("should reject - attestation has more aggregation bits", async function () {
    const attestation = generateAttestation({aggregationBits: [true, true] as BitList});
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
  });

  it("should reject - attestation block is invalid", async function () {
    const attestation = generateAttestation({aggregationBits: [true] as BitList});
    db.badBlock.has.resolves(true);
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
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
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
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
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chain.receiveAttestation.calledOnceWith(attestation)).to.be.true;
  });

  it("should ignore - validator already attested to target epoch", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(true);
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
    expect(result).to.equal(ExtendedValidatorResult.ignore);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(db.seenAttestationCache.hasCommitteeAttestation.calledOnceWith(attestation)).to.be.true;
  });

  it("should ignore - validator already attested to target epoch", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(true);
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
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
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
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
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
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
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
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
    attestationPreState.epochCtx.getIndexedAttestation = () => {
      return (attestation as unknown) as IndexedAttestation;
    };
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(false);
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
    expect(result).to.equal(ExtendedValidatorResult.reject);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(isValidIndexedAttestationStub.calledOnce).to.be.true;
  });

  it("should accept", async function () {
    const attestation = generateAttestation({
      aggregationBits: [true] as BitList,
    });
    db.seenAttestationCache.hasCommitteeAttestation.resolves(false);
    forkChoice.hasBlock.returns(true);
    const attestationPreState = {
      state: generateState(),
      epochCtx: new EpochContext(config),
    };
    attestationPreState.epochCtx.getIndexedAttestation = () => {
      return (attestation as unknown) as IndexedAttestation;
    };
    regen.getCheckpointState.resolves(attestationPreState);
    computeAttestationSubnetStub.returns(0);
    isValidIndexedAttestationStub.returns(true);
    const result = await validateGossipAttestation(config, chain, db, logger, attestation, 0);
    expect(result).to.equal(ExtendedValidatorResult.accept);
    expect(chain.receiveAttestation.called).to.be.false;
    expect(db.seenAttestationCache.addCommitteeAttestation.calledOnce).to.be.true;
  });
});
