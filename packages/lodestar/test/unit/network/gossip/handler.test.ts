import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {ForkName} from "@chainsafe/lodestar-config";

import {BeaconChain, ChainEventEmitter, IBeaconChain} from "../../../../src/chain";
import {INetwork, Network} from "../../../../src/network";
import {
  Eth2Gossipsub,
  stringifyGossipTopic,
  GossipEncoding,
  GossipType,
  encodeMessageData,
  TopicValidatorFn,
} from "../../../../src/network/gossip";
import {GossipHandler} from "../../../../src/network/gossip/handler";

import {StubbedBeaconDb} from "../../../utils/stub";
import {testLogger} from "../../../utils/logger";
import {createNode} from "../../../utils/network";
import {ForkDigestContext, toHexStringNoPrefix} from "../../../../src/util/forkDigestContext";
import {generateBlockSummary} from "../../../utils/block";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {IAttnetsService} from "../../../../src/network/subnets";

describe("gossip handler", function () {
  const logger = testLogger();
  const attnetsService = {} as IAttnetsService;
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
    chainStub.forkChoice = {getHead: () => generateBlockSummary()} as IForkChoice;
    networkStub = sinon.createStubInstance(Network);
    const multiaddr = "/ip4/127.0.0.1/tcp/0";
    const libp2p = await createNode(multiaddr);
    gossipsub = new Eth2Gossipsub({
      config,
      libp2p,
      validatorFns: new Map<string, TopicValidatorFn>(),
      logger,
      forkDigestContext,
      metrics: null,
    });
    networkStub.gossip = gossipsub;
    gossipsub.start();
    dbStub = new StubbedBeaconDb(sinon);
    const phase0ForkDigestBuf = Buffer.alloc(4, 1);
    const altairForkDigestBuf = Buffer.alloc(4, 2);
    const phase0ForkDigestHex = toHexStringNoPrefix(Buffer.alloc(4, 1));
    const altairForkDigestHex = toHexStringNoPrefix(Buffer.alloc(4, 2));
    forkDigestContext.forkName2ForkDigest.withArgs(ForkName.phase0).returns(phase0ForkDigestBuf);
    forkDigestContext.forkName2ForkDigest.withArgs(ForkName.altair).returns(altairForkDigestBuf);
    forkDigestContext.forkDigest2ForkName.withArgs(phase0ForkDigestHex).returns(ForkName.phase0);
    forkDigestContext.forkDigest2ForkName.withArgs(phase0ForkDigestBuf).returns(ForkName.phase0);
    forkDigestContext.forkDigest2ForkName.withArgs(altairForkDigestHex).returns(ForkName.altair);
    forkDigestContext.forkDigest2ForkName.withArgs(altairForkDigestBuf).returns(ForkName.altair);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should subscribe/unsubscribe on start/stop", function () {
    const handler = new GossipHandler(config, chainStub, gossipsub, attnetsService, dbStub, logger);
    expect(gossipsub.subscriptions.size).to.equal(0);
    handler.subscribeCoreTopics();
    expect(gossipsub.subscriptions.size).to.equal(5);
    handler.unsubscribeCoreTopics();
    expect(gossipsub.subscriptions.size).to.equal(0);
    handler.close();
  });

  it("should handle incoming gossip objects", async function () {
    const handler = new GossipHandler(config, chainStub, gossipsub, attnetsService, dbStub, logger);
    handler.subscribeCoreTopics();
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
      topicIDs: [stringifyGossipTopic(forkDigestContext, {type: GossipType.beacon_block, fork})],
    });
    expect(chainStub.receiveBlock.calledOnce).to.be.true;

    await gossipsub._processRpcMessage({
      data: encodeMessageData(
        GossipEncoding.ssz_snappy,
        SignedAggregateAndProof.serialize(SignedAggregateAndProof.defaultValue())
      ),
      receivedFrom: "foo",
      topicIDs: [stringifyGossipTopic(forkDigestContext, {type: GossipType.beacon_aggregate_and_proof, fork})],
    });
    expect(dbStub.aggregateAndProof.add.calledOnce).to.be.true;

    await gossipsub._processRpcMessage({
      data: encodeMessageData(
        GossipEncoding.ssz_snappy,
        SignedVoluntaryExit.serialize(SignedVoluntaryExit.defaultValue())
      ),
      receivedFrom: "foo",
      topicIDs: [stringifyGossipTopic(forkDigestContext, {type: GossipType.voluntary_exit, fork})],
    });
    expect(dbStub.voluntaryExit.add.calledOnce).to.be.true;

    await gossipsub._processRpcMessage({
      data: encodeMessageData(GossipEncoding.ssz_snappy, ProposerSlashing.serialize(ProposerSlashing.defaultValue())),
      receivedFrom: "foo",
      topicIDs: [stringifyGossipTopic(forkDigestContext, {type: GossipType.proposer_slashing, fork})],
    });
    expect(dbStub.proposerSlashing.add.calledOnce).to.be.true;

    await gossipsub._processRpcMessage({
      data: encodeMessageData(GossipEncoding.ssz_snappy, AttesterSlashing.serialize(AttesterSlashing.defaultValue())),
      receivedFrom: "foo",
      topicIDs: [stringifyGossipTopic(forkDigestContext, {type: GossipType.attester_slashing, fork})],
    });
    expect(dbStub.attesterSlashing.add.calledOnce).to.be.true;

    handler.unsubscribeCoreTopics();
    handler.close();
  });
});
