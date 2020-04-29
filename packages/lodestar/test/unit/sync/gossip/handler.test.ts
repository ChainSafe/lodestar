import sinon, {SinonStubbedInstance} from "sinon";
import {BeaconChain, IBeaconChain} from "../../../../src/chain";
import {INetwork, Libp2pNetwork} from "../../../../src/network";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {
  AttesterSlashingOperations,
  OpPool,
  ProposerSlashingOperations,
  VoluntaryExitOperations
} from "../../../../src/opPool";
import {IGossip} from "../../../../src/network/gossip/interface";
import {Gossip} from "../../../../src/network/gossip/gossip";
import {BeaconGossipHandler} from "../../../../src/sync/gossip";
import {generateEmptySignedBlock} from "../../../utils/block";
import {expect} from "chai";
import {generateEmptyAttesterSlashing, generateEmptyProposerSlashing} from "../../../utils/slashings";
import {generateEmptySignedAggregateAndProof, generateEmptySignedVoluntaryExit} from "../../../utils/attestation";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {MockBeaconChain} from "../../../utils/mocks/chain/chain";
import {generateState} from "../../../utils/state";

describe("gossip handler", function () {

  const logger = new WinstonLogger();
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
    gossipStub.subscribeToBlock.callsFake(async (digest, callback) => {
      await callback(generateEmptySignedBlock());
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool, logger);
    await handler.start();
    expect(chainStub.receiveBlock.calledOnce).to.be.true;
  });

  it("should handle new aggregate and proof", async function () {
    const aggregateAndProof = generateEmptySignedAggregateAndProof();
    gossipStub.subscribeToAggregateAndProof.callsFake(async (digest, callback) => {
      await callback(aggregateAndProof);
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool, logger);
    await handler.start();
    expect(chainStub.receiveAttestation.withArgs(aggregateAndProof.message.aggregate).calledOnce).to.be.true;
  });

  it("should handle new attester slashing", async function () {
    opPoolStub.attesterSlashings = sinon.createStubInstance(AttesterSlashingOperations);
    gossipStub.subscribeToAttesterSlashing.callsFake(async (digest, callback) => {
      await callback(generateEmptyAttesterSlashing());
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool, logger);
    await handler.start();
    expect(opPoolStub.attesterSlashings.receive.calledOnce).to.be.true;
  });

  it("should handle new proposer slashing", async function () {
    opPoolStub.proposerSlashings = sinon.createStubInstance(ProposerSlashingOperations);
    gossipStub.subscribeToProposerSlashing.callsFake(async (digest, callback) => {
      await callback(generateEmptyProposerSlashing());
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool, logger);
    await handler.start();
    expect(opPoolStub.proposerSlashings.receive.calledOnce).to.be.true;
  });

  it("should handle new voluntary exit", async function () {
    opPoolStub.voluntaryExits = sinon.createStubInstance(VoluntaryExitOperations);
    gossipStub.subscribeToVoluntaryExit.callsFake(async (digest, callback) => {
      await callback(generateEmptySignedVoluntaryExit());
    });
    const handler = new BeaconGossipHandler(chainStub, networkStub, opPoolStub as OpPool, logger);
    await handler.start();
    expect(opPoolStub.voluntaryExits.receive.calledOnce).to.be.true;
  });

  it("should handle fork digest changed", async function () {
    // handler is started and fork digest changed after that
    const state = generateState();
    const chain = new MockBeaconChain({
      genesisTime: 0,
      chainId: 0,
      networkId: 0n,
      state,
      config
    });
    const oldForkDigest = chain.currentForkDigest;
    const handler = new BeaconGossipHandler(chain, networkStub, opPoolStub as OpPool, logger);
    await handler.start();
    expect(gossipStub.subscribeToBlock.callCount).to.be.equal(1);
    // fork digest changed due to current version changed
    state.fork.currentVersion = Buffer.from([100, 0, 0, 0]);
    expect(config.types.ForkDigest.equals(oldForkDigest, chain.currentForkDigest)).to.be.false;
    chain.emit("forkDigest", chain.currentForkDigest);
    expect(gossipStub.unsubscribe.callCount).to.be.equal(5);
    expect(gossipStub.subscribeToBlock.callCount).to.be.equal(2);
  });

});