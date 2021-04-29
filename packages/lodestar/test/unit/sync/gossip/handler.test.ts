import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ForkName} from "@chainsafe/lodestar-config";

import {BeaconChain, ChainEventEmitter, IBeaconChain} from "../../../../src/chain";
import {INetwork, Network} from "../../../../src/network";
import {
  Eth2Gossipsub,
  getGossipTopicString,
  GossipEncoding,
  GossipType,
  encodeMessageData,
  TopicValidatorFn,
} from "../../../../src/network/gossip";
import {BeaconGossipHandler} from "../../../../src/sync/gossip";

import {StubbedBeaconDb} from "../../../utils/stub";
import {testLogger} from "../../../utils/logger";
import {createNode} from "../../../utils/network";
import {ForkDigestContext} from "../../../../src/util/forkDigestContext";

describe("gossip handler", function () {
  let forkDigestContext: SinonStubbedInstance<ForkDigestContext>;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let gossipsub: Eth2Gossipsub;
  let dbStub: StubbedBeaconDb;

  beforeEach(async function () {
    forkDigestContext = sinon.createStubInstance(ForkDigestContext);
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.emitter = new ChainEventEmitter();
    chainStub.getHeadForkName.returns(ForkName.phase0);
    chainStub.forkDigestContext = forkDigestContext;
    networkStub = sinon.createStubInstance(Network);
    const multiaddr = "/ip4/127.0.0.1/tcp/0";
    const libp2p = await createNode(multiaddr);
    gossipsub = new Eth2Gossipsub({
      config,
      libp2p,
      validatorFns: new Map<string, TopicValidatorFn>(),
      logger: testLogger(),
      forkDigestContext,
      metrics: null,
    });
    networkStub.gossip = gossipsub;
    gossipsub.start();
    dbStub = new StubbedBeaconDb(sinon);
    forkDigestContext.forkName2ForkDigest.returns(Buffer.alloc(4, 1));
    forkDigestContext.forkDigest2ForkName.returns(ForkName.phase0);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should subscribe/unsubscribe on start/stop", function () {
    const handler = new BeaconGossipHandler(config, chainStub, networkStub, dbStub);
    expect(gossipsub.subscriptions.size).to.equal(0);
    handler.start();
    expect(gossipsub.subscriptions.size).to.equal(5);
    handler.stop();
    expect(gossipsub.subscriptions.size).to.equal(0);
    handler.close();
  });

  it("should handle incoming gossip objects", async function () {
    const handler = new BeaconGossipHandler(config, chainStub, networkStub, dbStub);
    handler.start();
    const fork = ForkName.phase0;
    const {
      SignedBeaconBlock,
      SignedAggregateAndProof,
      SignedVoluntaryExit,
      ProposerSlashing,
      AttesterSlashing,
    } = config.types.phase0;

    await gossipsub._processRpcMessage({
      data: encodeMessageData(GossipEncoding.ssz_snappy, SignedBeaconBlock.serialize(SignedBeaconBlock.defaultValue())),
      receivedFrom: "foo",
      topicIDs: [getGossipTopicString(forkDigestContext, {type: GossipType.beacon_block, fork})],
    });
    expect(chainStub.receiveBlock.calledOnce).to.be.true;

    await gossipsub._processRpcMessage({
      data: encodeMessageData(
        GossipEncoding.ssz_snappy,
        SignedAggregateAndProof.serialize(SignedAggregateAndProof.defaultValue())
      ),
      receivedFrom: "foo",
      topicIDs: [getGossipTopicString(forkDigestContext, {type: GossipType.beacon_aggregate_and_proof, fork})],
    });
    expect(dbStub.aggregateAndProof.add.calledOnce).to.be.true;

    await gossipsub._processRpcMessage({
      data: encodeMessageData(
        GossipEncoding.ssz_snappy,
        SignedVoluntaryExit.serialize(SignedVoluntaryExit.defaultValue())
      ),
      receivedFrom: "foo",
      topicIDs: [getGossipTopicString(forkDigestContext, {type: GossipType.voluntary_exit, fork})],
    });
    expect(dbStub.voluntaryExit.add.calledOnce).to.be.true;

    await gossipsub._processRpcMessage({
      data: encodeMessageData(GossipEncoding.ssz_snappy, ProposerSlashing.serialize(ProposerSlashing.defaultValue())),
      receivedFrom: "foo",
      topicIDs: [getGossipTopicString(forkDigestContext, {type: GossipType.proposer_slashing, fork})],
    });
    expect(dbStub.proposerSlashing.add.calledOnce).to.be.true;

    await gossipsub._processRpcMessage({
      data: encodeMessageData(GossipEncoding.ssz_snappy, AttesterSlashing.serialize(AttesterSlashing.defaultValue())),
      receivedFrom: "foo",
      topicIDs: [getGossipTopicString(forkDigestContext, {type: GossipType.attester_slashing, fork})],
    });
    expect(dbStub.attesterSlashing.add.calledOnce).to.be.true;

    handler.stop();
    handler.close();
  });
});
