import sinon from "sinon";
import {expect} from "chai";
import {AbortController} from "@chainsafe/abort-controller";

import PeerId from "peer-id";
import {Discv5Discovery, ENR} from "@chainsafe/discv5";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/default";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";

import {Network, NetworkEvent, ReqRespMethod, getReqRespHandlers} from "../../../src/network";
import {INetworkOptions} from "../../../src/network/options";
import {GoodByeReasonCode} from "../../../src/constants";

import {generateEmptySignedBlock} from "../../utils/block";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {createNode} from "../../utils/network";
import {generateState} from "../../utils/state";
import {StubbedBeaconDb} from "../../utils/stub";
import {connect, disconnect, onPeerConnect, onPeerDisconnect} from "../../utils/network";
import {testLogger} from "../../utils/logger";
import {CommitteeSubscription} from "../../../src/network/subnets";
import {GossipHandlers} from "../../../src/network/gossip";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

const opts: INetworkOptions = {
  maxPeers: 1,
  targetPeers: 1,
  bootMultiaddrs: [],
  localMultiaddrs: [],
};

describe("network", function () {
  if (this.timeout() < 5000) this.timeout(5000);
  this.retries(2); // This test fail sometimes, with a 5% rate.

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function mockModules() {
    const controller = new AbortController();

    const block = generateEmptySignedBlock();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });

    const beaconConfig = createIBeaconConfig(config, state.genesisValidatorsRoot);
    const chain = new MockBeaconChain({genesisTime: 0, chainId: 0, networkId: BigInt(0), state, config: beaconConfig});
    const db = new StubbedBeaconDb(config);
    const reqRespHandlers = getReqRespHandlers({db, chain});
    const gossipHandlers = {} as GossipHandlers;

    const [libp2pA, libp2pB] = await Promise.all([createNode(multiaddr), createNode(multiaddr)]);
    const loggerA = testLogger("A");
    const loggerB = testLogger("B");

    const modules = {
      config: beaconConfig,
      chain,
      db,
      reqRespHandlers,
      gossipHandlers,
      signal: controller.signal,
      metrics: null,
    };
    const netA = new Network(opts, {...modules, libp2p: libp2pA, logger: loggerA});
    const netB = new Network(opts, {...modules, libp2p: libp2pB, logger: loggerB});

    await Promise.all([netA.start(), netB.start()]);

    afterEachCallbacks.push(async () => {
      chain.close();
      controller.abort();
      await Promise.all([netA.stop(), netB.stop()]);
      sinon.restore();
    });

    return {netA, netB, chain, controller};
  }

  it("should create a peer on connect", async function () {
    const {netA, netB} = await mockModules();
    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB.peerId, netB.localMultiaddrs)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);
  });

  it("should delete a peer on disconnect", async function () {
    const {netA, netB} = await mockModules();
    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB.peerId, netB.localMultiaddrs);
    await connected;

    const disconnection = Promise.all([onPeerDisconnect(netA), onPeerDisconnect(netB)]);
    await sleep(100);

    await disconnect(netA, netB.peerId);
    await disconnection;
    await sleep(200);

    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(0);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(0);
  });

  it("should connect to new peer by subnet", async function () {
    const subscription: CommitteeSubscription = {
      validatorIndex: 2000,
      subnet: 10,
      slot: 2000,
      isAggregator: false,
    };
    const {netA, netB} = await mockModules();
    netB.metadata.attnets[subscription.subnet] = true;
    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    const enrB = ENR.createFromPeerId(netB.peerId);
    enrB.set("attnets", Buffer.from(ssz.phase0.AttestationSubnets.serialize(netB.metadata.attnets)));
    enrB.setLocationMultiaddr((netB["libp2p"]._discovery.get("discv5") as Discv5Discovery).discv5.bindAddress);
    enrB.setLocationMultiaddr(netB["libp2p"].multiaddrs[0]);

    // let discv5 of A know enr of B
    const discovery: Discv5Discovery = netA["libp2p"]._discovery.get("discv5") as Discv5Discovery;
    discovery.discv5.addEnr(enrB);
    netA.prepareBeaconCommitteeSubnet([subscription]);
    await connected;

    expect(netA.getConnectionsByPeer().has(netB.peerId.toB58String())).to.be.equal(
      true,
      "netA has not connected to peerB"
    );
  });

  it("Should goodbye peers on stop", async function () {
    const {netA, netB, controller} = await mockModules();

    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB.peerId, netB.localMultiaddrs);
    await connected;

    // Wait some time and stop netA expecting to goodbye netB
    await sleep(500, controller.signal);

    const onGoodbyeNetB = sinon.stub<[phase0.Goodbye, PeerId]>();
    netB.events.on(NetworkEvent.reqRespRequest, (request, peer) => {
      if (request.method === ReqRespMethod.Goodbye) onGoodbyeNetB(request.body, peer);
    });

    await netA.stop();
    await sleep(500, controller.signal);

    expect(onGoodbyeNetB.callCount).to.equal(1, "netB must receive 1 goodbye");
    const [goodbye, peer] = onGoodbyeNetB.getCall(0).args;
    expect(peer.toB58String()).to.equal(netA.peerId.toB58String(), "netA must be the goodbye requester");
    expect(goodbye).to.equal(BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN), "goodbye reason must be CLIENT_SHUTDOWN");
  });

  it("Should goodbye peers on stop", async function () {
    const {netA, netB, controller} = await mockModules();

    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB.peerId, netB.localMultiaddrs);
    await connected;

    // Wait some time and stop netA expecting to goodbye netB
    await sleep(500, controller.signal);

    const onGoodbyeNetB = sinon.stub<[phase0.Goodbye, PeerId]>();
    netB.events.on(NetworkEvent.reqRespRequest, (request, peer) => {
      if (request.method === ReqRespMethod.Goodbye) onGoodbyeNetB(request.body, peer);
    });

    await netA.stop();
    await sleep(500, controller.signal);

    expect(onGoodbyeNetB.callCount).to.equal(1, "netB must receive 1 goodbye");
    const [goodbye, peer] = onGoodbyeNetB.getCall(0).args;
    expect(peer.toB58String()).to.equal(netA.peerId.toB58String(), "netA must be the goodbye requester");
    expect(goodbye).to.equal(BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN), "goodbye reason must be CLIENT_SHUTDOWN");
  });

  it("Should subscribe to gossip core topics on demand", async () => {
    const {netA} = await mockModules();

    expect(netA.gossip.subscriptions.size).to.equal(0);
    netA.subscribeGossipCoreTopics();
    expect(netA.gossip.subscriptions.size).to.equal(5);
    netA.unsubscribeGossipCoreTopics();
    expect(netA.gossip.subscriptions.size).to.equal(0);
    netA.close();
  });
});
