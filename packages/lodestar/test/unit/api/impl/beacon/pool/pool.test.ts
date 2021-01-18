import {config} from "@chainsafe/lodestar-config/minimal";
import {expect} from "chai";
import sinon, {SinonStub} from "sinon";
import {BeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";
import {Libp2pNetwork} from "../../../../../../src/network/network";
import {BeaconSync} from "../../../../../../src/sync/sync";
import {
  generateAttestation,
  generateAttestationData,
  generateEmptySignedVoluntaryExit,
} from "../../../../../utils/attestation";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {SinonStubbedInstance} from "sinon";
import {IBeaconChain} from "../../../../../../src/chain";
import * as attesterSlashingValidation from "../../../../../../src/chain/validation/attesterSlashing";
import * as proposerSlashingValidation from "../../../../../../src/chain/validation/proposerSlashing";
import * as voluntaryExitValidation from "../../../../../../src/chain/validation/voluntaryExit";

import {BeaconChain} from "../../../../../../src/chain/chain";
import {AttesterSlashing, ProposerSlashing, ValidatorIndex} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {Gossip} from "../../../../../../src/network/gossip/gossip";
import {IGossip} from "../../../../../../src/network/gossip/interface";
import {generateEmptySignedBlockHeader} from "../../../../../utils/block";

describe("beacon pool api impl", function () {
  let poolApi: BeaconPoolApi;
  let dbStub: StubbedBeaconDb;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let networkStub: SinonStubbedInstance<Libp2pNetwork>;
  let gossipStub: SinonStubbedInstance<IGossip>;
  let validateGossipAttesterSlashing: SinonStub;
  let validateGossipProposerSlashing: SinonStub;
  let validateVoluntaryExit: SinonStub;

  beforeEach(function () {
    dbStub = new StubbedBeaconDb(sinon, config);
    chainStub = sinon.createStubInstance(BeaconChain);
    gossipStub = sinon.createStubInstance(Gossip);
    gossipStub.publishAttesterSlashing = sinon.stub();
    gossipStub.publishProposerSlashing = sinon.stub();
    gossipStub.publishVoluntaryExit = sinon.stub();
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    networkStub.gossip = gossipStub;
    poolApi = new BeaconPoolApi(
      {},
      {
        config,
        db: dbStub,
        sync: sinon.createStubInstance(BeaconSync),
        network: networkStub,
        chain: chainStub,
      }
    );
    validateGossipAttesterSlashing = sinon.stub(attesterSlashingValidation, "validateGossipAttesterSlashing");
    validateGossipProposerSlashing = sinon.stub(proposerSlashingValidation, "validateGossipProposerSlashing");
    validateVoluntaryExit = sinon.stub(voluntaryExitValidation, "validateGossipVoluntaryExit");
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("getAttestations", function () {
    it("no filters", async function () {
      dbStub.attestation.values.resolves([generateAttestation(), generateAttestation()]);
      const attestations = await poolApi.getAttestations();
      expect(attestations.length).to.be.equal(2);
    });

    it("with filters", async function () {
      dbStub.attestation.values.resolves([
        generateAttestation({data: generateAttestationData(0, 1, 0, 1)}),
        generateAttestation({data: generateAttestationData(0, 1, 1, 0)}),
        generateAttestation({data: generateAttestationData(0, 1, 3, 2)}),
      ]);
      const attestations = await poolApi.getAttestations({slot: 1, committeeIndex: 0});
      expect(attestations.length).to.be.equal(1);
    });
  });

  describe("submitAttesterSlashing", function () {
    const atterterSlashing: AttesterSlashing = {
      attestation1: {
        attestingIndices: [0] as List<ValidatorIndex>,
        data: generateAttestationData(0, 1, 0, 1),
        signature: Buffer.alloc(96),
      },
      attestation2: {
        attestingIndices: [0] as List<ValidatorIndex>,
        data: generateAttestationData(0, 1, 0, 1),
        signature: Buffer.alloc(96),
      },
    };

    it("should broadcast and persist to db", async function () {
      validateGossipAttesterSlashing.resolves();
      await poolApi.submitAttesterSlashing(atterterSlashing);
      expect(gossipStub.publishAttesterSlashing.calledOnceWithExactly(atterterSlashing)).to.be.true;
      expect(dbStub.attesterSlashing.add.calledOnceWithExactly(atterterSlashing)).to.be.true;
    });

    it("should not broadcast or persist to db", async function () {
      validateGossipAttesterSlashing.throws(new Error("unit test error"));
      await poolApi.submitAttesterSlashing(atterterSlashing).catch(() => ({}));
      expect(gossipStub.publishAttesterSlashing.calledOnce).to.be.false;
      expect(dbStub.attesterSlashing.add.calledOnce).to.be.false;
    });
  });

  describe("submitProposerSlashing", function () {
    const proposerSlashing: ProposerSlashing = {
      signedHeader1: generateEmptySignedBlockHeader(),
      signedHeader2: generateEmptySignedBlockHeader(),
    };

    it("should broadcast and persist to db", async function () {
      validateGossipProposerSlashing.resolves();
      await poolApi.submitProposerSlashing(proposerSlashing);
      expect(gossipStub.publishProposerSlashing.calledOnceWithExactly(proposerSlashing)).to.be.true;
      expect(dbStub.proposerSlashing.add.calledOnceWithExactly(proposerSlashing)).to.be.true;
    });

    it("should not broadcast or persist to db", async function () {
      validateGossipProposerSlashing.throws(new Error("unit test error"));
      await poolApi.submitProposerSlashing(proposerSlashing).catch(() => ({}));
      expect(gossipStub.publishProposerSlashing.calledOnce).to.be.false;
      expect(dbStub.proposerSlashing.add.calledOnce).to.be.false;
    });
  });

  describe("submitVoluntaryExit", function () {
    const voluntaryExit = generateEmptySignedVoluntaryExit();

    it("should broadcast and persist to db", async function () {
      validateVoluntaryExit.resolves();
      await poolApi.submitVoluntaryExit(voluntaryExit);
      expect(gossipStub.publishVoluntaryExit.calledOnceWithExactly(voluntaryExit)).to.be.true;
      expect(dbStub.voluntaryExit.add.calledOnceWithExactly(voluntaryExit)).to.be.true;
    });

    it("should not broadcast or persist to db", async function () {
      validateVoluntaryExit.throws(new Error("unit test error"));
      await poolApi.submitVoluntaryExit(voluntaryExit).catch(() => ({}));
      expect(gossipStub.publishVoluntaryExit.calledOnce).to.be.false;
      expect(dbStub.voluntaryExit.add.calledOnce).to.be.false;
    });
  });
});
