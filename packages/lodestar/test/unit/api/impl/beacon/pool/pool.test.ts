import {expect} from "chai";
import sinon from "sinon";
import {getBeaconPoolApi} from "../../../../../../src/api/impl/beacon/pool";
import {Network} from "../../../../../../src/network/network";
import {
  generateAttestation,
  generateAttestationData,
  generateEmptySignedVoluntaryExit,
} from "../../../../../utils/attestation";
import {SinonStubbedInstance} from "sinon";
import {IBeaconChain} from "../../../../../../src/chain";
import * as attesterSlashingValidation from "../../../../../../src/chain/validation/attesterSlashing";
import * as proposerSlashingValidation from "../../../../../../src/chain/validation/proposerSlashing";
import * as voluntaryExitValidation from "../../../../../../src/chain/validation/voluntaryExit";

import {phase0, ValidatorIndex} from "@chainsafe/lodestar-types";
import {List} from "@chainsafe/ssz";
import {Eth2Gossipsub} from "../../../../../../src/network/gossip";
import {generateEmptySignedBlockHeader} from "../../../../../utils/block";
import {setupApiImplTestServer} from "../../index.test";
import {SinonStubFn} from "../../../../../utils/types";
import {testLogger} from "../../../../../utils/logger";
import {AggregatedAttestationPool, OpPool} from "../../../../../../src/chain/opPools";

describe("beacon pool api impl", function () {
  const logger = testLogger();
  let poolApi: ReturnType<typeof getBeaconPoolApi>;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let opPool: SinonStubbedInstance<OpPool>;
  let networkStub: SinonStubbedInstance<Network>;
  let gossipStub: SinonStubbedInstance<Eth2Gossipsub>;
  let validateGossipAttesterSlashing: SinonStubFn<typeof attesterSlashingValidation["validateGossipAttesterSlashing"]>;
  let validateGossipProposerSlashing: SinonStubFn<typeof proposerSlashingValidation["validateGossipProposerSlashing"]>;
  let validateVoluntaryExit: SinonStubFn<typeof voluntaryExitValidation["validateGossipVoluntaryExit"]>;
  let aggregatedAttestationPool: SinonStubbedInstance<AggregatedAttestationPool>;

  beforeEach(function () {
    const server = setupApiImplTestServer();
    chainStub = server.chainStub;
    aggregatedAttestationPool = sinon.createStubInstance(AggregatedAttestationPool);
    ((chainStub as unknown) as {
      aggregatedAttestationPool: SinonStubbedInstance<AggregatedAttestationPool>;
    }).aggregatedAttestationPool = aggregatedAttestationPool;
    opPool = sinon.createStubInstance(OpPool);
    ((chainStub as unknown) as {
      opPool: SinonStubbedInstance<OpPool>;
    }).opPool = opPool;
    gossipStub = sinon.createStubInstance(Eth2Gossipsub);
    gossipStub.publishAttesterSlashing = sinon.stub();
    gossipStub.publishProposerSlashing = sinon.stub();
    gossipStub.publishVoluntaryExit = sinon.stub();
    networkStub = server.networkStub;
    networkStub.gossip = (gossipStub as unknown) as Eth2Gossipsub;
    poolApi = getBeaconPoolApi({
      logger,
      network: networkStub,
      chain: chainStub,
      metrics: null,
    });
    validateGossipAttesterSlashing = sinon.stub(attesterSlashingValidation, "validateGossipAttesterSlashing");
    validateGossipProposerSlashing = sinon.stub(proposerSlashingValidation, "validateGossipProposerSlashing");
    validateVoluntaryExit = sinon.stub(voluntaryExitValidation, "validateGossipVoluntaryExit");
  });

  afterEach(function () {
    sinon.restore();
  });

  describe("getPoolAttestations", function () {
    it("no filters", async function () {
      aggregatedAttestationPool.getAll.returns([generateAttestation(), generateAttestation()]);
      const {data: attestations} = await poolApi.getPoolAttestations();
      expect(attestations.length).to.be.equal(2);
    });

    it("with filters", async function () {
      aggregatedAttestationPool.getAll.returns([
        generateAttestation({data: generateAttestationData(0, 1, 0, 1)}),
        generateAttestation({data: generateAttestationData(0, 1, 1, 0)}),
        generateAttestation({data: generateAttestationData(0, 1, 3, 2)}),
      ]);
      const {data: attestations} = await poolApi.getPoolAttestations({slot: 1, committeeIndex: 0});
      expect(attestations.length).to.be.equal(1);
    });
  });

  describe("submitPoolAttesterSlashing", function () {
    const atterterSlashing: phase0.AttesterSlashing = {
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

    it("should broadcast", async function () {
      validateGossipAttesterSlashing.resolves();
      await poolApi.submitPoolAttesterSlashing(atterterSlashing);
      expect(gossipStub.publishAttesterSlashing.calledOnceWithExactly(atterterSlashing)).to.be.true;
    });

    it("should not broadcast", async function () {
      validateGossipAttesterSlashing.throws(new Error("unit test error"));
      await poolApi.submitPoolAttesterSlashing(atterterSlashing).catch(() => ({}));
      expect(gossipStub.publishAttesterSlashing.calledOnce).to.be.false;
    });
  });

  describe("submitPoolProposerSlashing", function () {
    const proposerSlashing: phase0.ProposerSlashing = {
      signedHeader1: generateEmptySignedBlockHeader(),
      signedHeader2: generateEmptySignedBlockHeader(),
    };

    it("should broadcast", async function () {
      validateGossipProposerSlashing.resolves();
      await poolApi.submitPoolProposerSlashing(proposerSlashing);
      expect(gossipStub.publishProposerSlashing.calledOnceWithExactly(proposerSlashing)).to.be.true;
    });

    it("should not broadcast", async function () {
      validateGossipProposerSlashing.throws(new Error("unit test error"));
      await poolApi.submitPoolProposerSlashing(proposerSlashing).catch(() => ({}));
      expect(gossipStub.publishProposerSlashing.calledOnce).to.be.false;
    });
  });

  describe("submitPoolVoluntaryExit", function () {
    const voluntaryExit = generateEmptySignedVoluntaryExit();

    it("should broadcast", async function () {
      validateVoluntaryExit.resolves();
      await poolApi.submitPoolVoluntaryExit(voluntaryExit);
      expect(gossipStub.publishVoluntaryExit.calledOnceWithExactly(voluntaryExit)).to.be.true;
    });

    it("should not broadcast", async function () {
      validateVoluntaryExit.throws(new Error("unit test error"));
      await poolApi.submitPoolVoluntaryExit(voluntaryExit).catch(() => ({}));
      expect(gossipStub.publishVoluntaryExit.calledOnce).to.be.false;
    });
  });
});
