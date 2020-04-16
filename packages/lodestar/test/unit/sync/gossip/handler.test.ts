import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../src/chain";
import {INetwork, Libp2pNetwork} from "../../../../src/network";
import {
  AttesterSlashingOperations,
  OpPool,
  ProposerSlashingOperations,
  VoluntaryExitOperations
} from "../../../../src/opPool";
import {IGossip} from "../../../../src/network/gossip/interface";
import {Gossip} from "../../../../src/network/gossip/gossip";
import {BeaconGossipHandler} from "../../../../src/sync/gossip/handler";
import {generateEmptySignedBlock} from "../../../utils/block";
import {expect} from "chai";
import {generateAggregateAndProof} from "../../../utils/aggregateAndProof";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../utils/slashings";
import {generateEmptySignedVoluntaryExit} from "../../../utils/attestation";

describe("gossip handler", function () {

  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let gossipStub: SinonStubbedInstance<IGossip>;
  let opPoolStub: {
    attesterSlashings: SinonStubbedInstance<AttesterSlashingOperations>;
    proposerSlashings: SinonStubbedInstance<ProposerSlashingOperations>;
    voluntaryExits: SinonStubbedInstance<VoluntaryExitOperations>;
  }|OpPool;
  
  beforeEach(function () {
    chainStub = sinon.createStubInstance(BeaconChain);
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    gossipStub = sinon.createStubInstance(Gossip);
    networkStub.gossip = gossipStub;
    // @ts-ignore
    opPoolStub = sinon.createStubInstance(OpPool);
  });
    
  it("should handle new block", async function () {
    gossipStub.subscribeToBlock.callsFake(async (callback) => {
      await callback(generateEmptySignedBlock());
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool);
    await handler.start();
    expect(chainStub.receiveBlock.calledOnce).to.be.true;
  });
    
  it("should handle new aggregate and proof", async function () {
    const aggregateAndProof = generateAggregateAndProof();
    gossipStub.subscribeToAggregateAndProof.callsFake(async (callback) => {
      await callback(aggregateAndProof);
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool);
    await handler.start();
    expect(chainStub.receiveAttestation.withArgs(aggregateAndProof.aggregate).calledOnce).to.be.true;
  });
    
  it("should handle new attester slashing", async function () {
    opPoolStub.attesterSlashings = sinon.createStubInstance(AttesterSlashingOperations);
    gossipStub.subscribeToAttesterSlashing.callsFake(async (callback) => {
      await callback(generateEmptyAttesterSlashing());
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool);
    await handler.start();
    expect(opPoolStub.attesterSlashings.receive.calledOnce).to.be.true;
  });
    
  it("should handle new proposer slashing", async function () {
    opPoolStub.proposerSlashings = sinon.createStubInstance(ProposerSlashingOperations);
    gossipStub.subscribeToProposerSlashing.callsFake(async (callback) => {
      await callback(generateEmptyProposerSlashing());
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool);
    await handler.start();
    expect(opPoolStub.proposerSlashings.receive.calledOnce).to.be.true;
  });
    
  it("should handle new voluntary exit", async function () {
    opPoolStub.voluntaryExits = sinon.createStubInstance(VoluntaryExitOperations);
    gossipStub.subscribeToVoluntaryExit.callsFake(async (callback) => {
      await callback(generateEmptySignedVoluntaryExit());
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool);
    await handler.start();
    expect(opPoolStub.voluntaryExits.receive.calledOnce).to.be.true;
  });
    
});