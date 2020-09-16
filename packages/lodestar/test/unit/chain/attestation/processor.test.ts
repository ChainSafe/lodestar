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
import * as gossipUtils from "../../../../src/network/gossip/utils";
import {StubbedBeaconDb} from "../../../utils/stub";
import {generateAttestation} from "../../../utils/attestation";
import {generateState} from "../../../utils/state";
import {silentLogger} from "../../../utils/logger";

describe("chain attestation processor", function () {
  let chain: SinonStubbedInstance<IBeaconChain>;
  let forkChoice: SinonStubbedInstance<ForkChoice>;
  let db: StubbedBeaconDb;
  let attestationPrestateStub: SinonStub;
  let isValidIndexedAttestationStub: SinonStub;

  const logger = silentLogger;

  beforeEach(function () {
    chain = sinon.createStubInstance(BeaconChain);
    forkChoice = sinon.createStubInstance(ForkChoice);
    chain.forkChoice = forkChoice;
    db = new StubbedBeaconDb(sinon);
    attestationPrestateStub = sinon.stub(gossipUtils, "getAttestationPreState");
    isValidIndexedAttestationStub = sinon.stub(attestationUtils, "isValidIndexedAttestation");
  });

  afterEach(function () {
    attestationPrestateStub.restore();
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
    attestationPrestateStub.resolves(null);
    await processAttestation(config, chain, logger, db, attestation);
    expect(attestationPrestateStub.calledOnceWith(config, chain, db, attestation.data.target)).to.be.true;
    expect(forkChoice.onAttestation.notCalled).to.be.true;
  });

  it("invalid indexed attestation", async function () {
    const attestation = generateAttestation({});
    forkChoice.getAncestor.returns(attestation.data.target.root.valueOf() as Uint8Array);
    const epochCtxStub = sinon.createStubInstance(EpochContext);
    epochCtxStub.getIndexedAttestation.returns((attestation as unknown) as IndexedAttestation);
    attestationPrestateStub.resolves({
      state: generateState(),
      epochCtx: epochCtxStub,
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
    attestationPrestateStub.resolves({
      state: generateState({
        balances: [BigInt(32), BigInt(32), BigInt(32), BigInt(32)] as List<bigint>,
      }),
      epochCtx: epochCtxStub,
    });
    isValidIndexedAttestationStub.returns(true);
    epochCtxStub.getAttestingIndices.returns([1, 3]);
    await processAttestation(config, chain, logger, db, attestation);
    expect(forkChoice.onAttestation.calledOnce).to.be.true;
  });
});
