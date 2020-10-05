import {expect} from "chai";
import sinon, {SinonStub, SinonStubbedInstance} from "sinon";

import {List} from "@chainsafe/ssz";
import {IndexedAttestation} from "@chainsafe/lodestar-types";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";
import * as attestationUtils from "@chainsafe/lodestar-beacon-state-transition/lib/fast/block/isValidIndexedAttestation";

import {BeaconChain, IBeaconChain} from "../../../../src/chain";
import {processAttestation} from "../../../../src/chain/attestation";
import {StateRegenerator} from "../../../../src/chain/regen";
import {StubbedBeaconDb} from "../../../utils/stub";
import {generateAttestation} from "../../../utils/attestation";
import {generateState} from "../../../utils/state";
import {silentLogger} from "../../../utils/logger";

describe("chain attestation processor", function () {
  let chain: SinonStubbedInstance<IBeaconChain>;
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let regen: SinonStubbedInstance<StateRegenerator>;
  let db: StubbedBeaconDb;
  let isValidIndexedAttestationStub: SinonStub;

  const logger = silentLogger;

  beforeEach(function () {
    chain = sinon.createStubInstance(BeaconChain);
    forkChoice = sinon.createStubInstance(ForkChoice);
    regen = sinon.createStubInstance(StateRegenerator);
    chain.forkChoice = forkChoice;
    chain.regen = regen;
    db = new StubbedBeaconDb(sinon);
    isValidIndexedAttestationStub = sinon.stub(attestationUtils, "isValidIndexedAttestation");
  });

  afterEach(function () {
    isValidIndexedAttestationStub.restore();
  });

  it("attestation block ancestor doesn't exist", async function () {
    const attestation = generateAttestation({});
    forkChoice.getAncestor.throws();
    await processAttestation(config, chain, logger, db, attestation);
    expect(forkChoice.getAncestor.calledOnceWith(attestation.data.beaconBlockRoot.valueOf() as Uint8Array, 0)).to.be
      .true;
    expect(forkChoice.onAttestation.notCalled).to.be.true;
  });

  it("missing attestation prestate", async function () {
    const attestation = generateAttestation({});
    forkChoice.getAncestor.returns(attestation.data.target.root.valueOf() as Uint8Array);
    regen.getCheckpointState.throws();
    await processAttestation(config, chain, logger, db, attestation);
    expect(regen.getCheckpointState.calledOnceWith(attestation.data.target)).to.be.true;
    expect(forkChoice.onAttestation.notCalled).to.be.true;
  });

  it("invalid indexed attestation", async function () {
    const attestation = generateAttestation({});
    forkChoice.getAncestor.returns(attestation.data.target.root.valueOf() as Uint8Array);
    const epochCtxStub = sinon.createStubInstance(EpochContext);
    epochCtxStub.getIndexedAttestation.returns((attestation as unknown) as IndexedAttestation);
    regen.getCheckpointState.resolves({
      state: generateState(),
      epochCtx: (epochCtxStub as unknown) as EpochContext,
    });
    isValidIndexedAttestationStub.returns(false);
    await processAttestation(config, chain, logger, db, attestation);
    expect(isValidIndexedAttestationStub.calledOnceWith(epochCtxStub, sinon.match.any, attestation)).to.be.true;
    expect(forkChoice.onAttestation.notCalled).to.be.true;
  });

  it("processed attestation", async function () {
    const attestation = generateAttestation({});
    forkChoice.getAncestor.returns(attestation.data.target.root.valueOf() as Uint8Array);
    const epochCtxStub = sinon.createStubInstance(EpochContext);
    epochCtxStub.getIndexedAttestation.returns((attestation as unknown) as IndexedAttestation);
    regen.getCheckpointState.resolves({
      state: generateState({
        balances: [BigInt(32), BigInt(32), BigInt(32), BigInt(32)] as List<bigint>,
      }),
      epochCtx: (epochCtxStub as unknown) as EpochContext,
    });
    isValidIndexedAttestationStub.returns(true);
    epochCtxStub.getAttestingIndices.returns([1, 3]);
    await processAttestation(config, chain, logger, db, attestation);
    expect(forkChoice.onAttestation.calledOnce).to.be.true;
  });
});
