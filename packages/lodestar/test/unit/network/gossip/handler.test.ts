import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/default";
import {ForkName} from "@chainsafe/lodestar-params";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {AbortController} from "@chainsafe/abort-controller";

import {BeaconChain, ChainEventEmitter, IBeaconChain} from "../../../../src/chain";
import {INetwork, Network, ReqRespHandler} from "../../../../src/network";
import {Eth2Gossipsub, TopicValidatorFn} from "../../../../src/network/gossip";

import {StubbedBeaconDb} from "../../../utils/stub";
import {testLogger} from "../../../utils/logger";
import {createNode} from "../../../utils/network";
import {ForkDigestContext, toHexStringNoPrefix} from "../../../../src/util/forkDigestContext";
import {generateBlockSummary} from "../../../utils/block";
import {INetworkOptions} from "../../../../src/network/options";

describe("gossip handler", function () {
  const logger = testLogger();
  let forkDigestContext: SinonStubbedInstance<ForkDigestContext>;
  let chainStub: SinonStubbedInstance<IBeaconChain>;
  let network: INetwork;
  let gossipsub: Eth2Gossipsub;
  let dbStub: StubbedBeaconDb;

  const opts: INetworkOptions = {
    maxPeers: 1,
    targetPeers: 1,
    bootMultiaddrs: [],
    localMultiaddrs: [],
  };

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  beforeEach(async function () {
    forkDigestContext = sinon.createStubInstance(ForkDigestContext);
    chainStub = sinon.createStubInstance(BeaconChain);
    chainStub.emitter = new ChainEventEmitter();
    chainStub.getHeadForkName.returns(ForkName.phase0);
    chainStub.forkDigestContext = forkDigestContext;
    chainStub.forkChoice = {getHead: () => generateBlockSummary()} as IForkChoice;
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
    gossipsub.start();
    dbStub = new StubbedBeaconDb(sinon);

    network = new Network(opts, {
      config,
      libp2p,
      logger,
      metrics: null,
      chain: chainStub,
      db: dbStub,
      reqRespHandler: sinon.createStubInstance(ReqRespHandler),
      signal: controller.signal,
    });

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
    expect(gossipsub.subscriptions.size).to.equal(0);
    network.subscribeGossipCoreTopics();
    expect(gossipsub.subscriptions.size).to.equal(5);
    network.unsubscribeGossipCoreTopics();
    expect(gossipsub.subscriptions.size).to.equal(0);
    network.close();
  });

  // TODO: Test sending and receiving various gossip objects
});
