import sinon from "sinon";
import {expect} from "chai";
import {AbortController} from "@chainsafe/abort-controller";

import PeerId from "peer-id";
import {ENR} from "@chainsafe/discv5";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/default";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";

import {Network, NetworkEvent, ReqRespMethod, getReqRespHandlers} from "../../../src/network";
import {defaultNetworkOptions, INetworkOptions} from "../../../src/network/options";
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
import {ENRKey} from "../../../src/network/metadata";
import {memoOnce} from "../../utils/cache";
import {Multiaddr} from "multiaddr";

let port = 9000;
const multiaddr = "/ip4/127.0.0.1/tcp/0";

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

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  async function getOpts(peerId: PeerId): Promise<INetworkOptions> {
    const bindAddrUdp = `/ip4/0.0.0.0/udp/${port++}`;
    const enr = ENR.createFromPeerId(peerId);
    enr.setLocationMultiaddr(new Multiaddr(bindAddrUdp));

    return {
      ...defaultNetworkOptions,
      maxPeers: 1,
      targetPeers: 1,
      bootMultiaddrs: [],
      localMultiaddrs: [],
      discv5FirstQueryDelayMs: 0,
      discv5: {
        enr,
        bindAddr: bindAddrUdp,
        bootEnrs: [],
        enabled: true,
      },
    };
  }

  const getStaticData = memoOnce(() => {
    const block = generateEmptySignedBlock();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });
    const beaconConfig = createIBeaconConfig(config, state.genesisValidatorsRoot);
    return {block, state, config: beaconConfig};
  });

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createTestNode(nodeName: string) {
    const {state, config} = getStaticData();
    const chain = new MockBeaconChain({genesisTime: 0, chainId: 0, networkId: BigInt(0), state, config});
    const db = new StubbedBeaconDb(config);
    const reqRespHandlers = getReqRespHandlers({db, chain});
    const gossipHandlers = {} as GossipHandlers;

    const libp2p = await createNode(multiaddr);
    const logger = testLogger(nodeName);

    const opts = await getOpts(libp2p.peerId);

    const modules = {
      config,
      chain,
      db,
      reqRespHandlers,
      gossipHandlers,
      signal: controller.signal,
      metrics: null,
    };

    const network = new Network(opts, {...modules, libp2p, logger});
    await network.start();

    afterEachCallbacks.push(async () => {
      chain.close();
      controller.abort();
      await network.stop();
      sinon.restore();
    });

    return {network, chain};
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createTestNodesAB() {
    return Promise.all([createTestNode("A"), createTestNode("B")]);
  }

  it("should create a peer on connect", async function () {
    const [{network: netA}, {network: netB}] = await createTestNodesAB();
    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB.peerId, netB.localMultiaddrs)]);
    expect(Array.from(netA.getConnectionsByPeer().values()).length).to.equal(1);
    expect(Array.from(netB.getConnectionsByPeer().values()).length).to.equal(1);
  });

  it("should delete a peer on disconnect", async function () {
    const [{network: netA}, {network: netB}] = await createTestNodesAB();
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

  // Current implementation of discv5 consumer doesn't allow to deterministically force a peer to be found
  // a random find node lookup can yield no results if there are too few peers in the DHT
  it.skip("should connect to new peer by subnet", async function () {
    const [{network: netBootnode}, {network: netA}, {network: netB}] = await Promise.all([
      createTestNode("bootnode"),
      createTestNode("A"),
      createTestNode("B"),
    ]);

    if (!netBootnode.discv5) throw Error("discv5 in bootnode is not enabled");
    if (!netA.discv5) throw Error("discv5 in A is not enabled");
    if (!netB.discv5) throw Error("discv5 in B is not enabled");

    const subscription: CommitteeSubscription = {
      validatorIndex: 2000,
      subnet: 10,
      slot: 2000,
      isAggregator: false,
    };

    netB.metadata.attnets[subscription.subnet] = true;
    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);

    // Add subnets to B ENR
    netB.discv5.enr.set(ENRKey.attnets, ssz.phase0.AttestationSubnets.serialize(netB.metadata.attnets));

    // A knows about bootnode
    netA.discv5.addEnr(netBootnode.discv5.enr);
    expect(netA.discv5.kadValues()).have.length(1, "wrong netA kad length");
    // bootnode knows about B
    netBootnode.discv5.addEnr(netB.discv5.enr);

    // const enrB = ENR.createFromPeerId(netB.peerId);
    // enrB.set(ENRKey.attnets, Buffer.from(ssz.phase0.AttestationSubnets.serialize(netB.metadata.attnets)));

    // Mock findNode to immediately find enrB when attempting to find nodes
    // netA.discv5.findNode = async () => {
    //   console.log("CALLING FIND_NODE");
    //   netA.discv5?.emit("discovered", enrB);
    //   return [enrB];
    // };

    netA.prepareBeaconCommitteeSubnet([subscription]);
    await connected;

    expect(netA.getConnectionsByPeer().has(netB.peerId.toB58String())).to.be.equal(
      true,
      "netA has not connected to peerB"
    );
  });

  it("Should goodbye peers on stop", async function () {
    const [{network: netA}, {network: netB}] = await createTestNodesAB();

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
    const [{network: netA}, {network: netB}] = await createTestNodesAB();

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
    const {network: netA} = await createTestNode("A");

    expect(netA.gossip.subscriptions.size).to.equal(0);
    netA.subscribeGossipCoreTopics();
    expect(netA.gossip.subscriptions.size).to.equal(5);
    netA.unsubscribeGossipCoreTopics();
    expect(netA.gossip.subscriptions.size).to.equal(0);
    netA.close();
  });
});
