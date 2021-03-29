import sinon from "sinon";
import {expect} from "chai";
import {AbortController} from "abort-controller";

import PeerId from "peer-id";
import {Discv5Discovery, ENR} from "@chainsafe/discv5";
import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";

import {Network, NetworkEvent, ReqRespHandler} from "../../../src/network";
import {INetworkOptions} from "../../../src/network/options";
import {GoodByeReasonCode, Method} from "../../../src/constants";

import {generateEmptySignedBlock} from "../../utils/block";
import {MockBeaconChain} from "../../utils/mocks/chain/chain";
import {createNode} from "../../utils/network";
import {generateState} from "../../utils/state";
import {StubbedBeaconDb} from "../../utils/stub";
import {connect, disconnect, onPeerConnect, onPeerDisconnect} from "../../utils/network";
import {testLogger} from "../../utils/logger";

const multiaddr = "/ip4/127.0.0.1/tcp/0";

const opts: INetworkOptions = {
  maxPeers: 1,
  targetPeers: 1,
  bootMultiaddrs: [],
  rpcTimeout: 5000,
  connectTimeout: 5000,
  disconnectTimeout: 5000,
  localMultiaddrs: [],
};

describe("network", function () {
  if (this.timeout() < 5000) this.timeout(5000);

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
        root: config.types.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });

    const chain = new MockBeaconChain({genesisTime: 0, chainId: 0, networkId: BigInt(0), state, config});
    const db = new StubbedBeaconDb(sinon, config);
    const reqRespHandler = new ReqRespHandler({db, chain});

    const [libp2pA, libp2pB] = await Promise.all([createNode(multiaddr), createNode(multiaddr)]);
    const loggerA = testLogger("A");
    const loggerB = testLogger("B");

    const modules = {config, chain, db, reqRespHandler, signal: controller.signal};
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
    const subnetId = 10;
    const {netA, netB} = await mockModules();
    netB.metadata.attnets[subnetId] = true;
    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    const enrB = ENR.createFromPeerId(netB.peerId);
    enrB.set("attnets", Buffer.from(config.types.phase0.AttestationSubnets.serialize(netB.metadata.attnets)));
    enrB.setLocationMultiaddr((netB["libp2p"]._discovery.get("discv5") as Discv5Discovery).discv5.bindAddress);
    enrB.setLocationMultiaddr(netB["libp2p"].multiaddrs[0]);

    // let discv5 of A know enr of B
    const discovery: Discv5Discovery = netA["libp2p"]._discovery.get("discv5") as Discv5Discovery;
    discovery.discv5.addEnr(enrB);
    netA.requestAttSubnets([{subnetId, toSlot: Infinity}]);
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
    netB.events.on(NetworkEvent.reqRespRequest, (method, request, peer) => {
      if (method === Method.Goodbye) onGoodbyeNetB(request as phase0.Goodbye, peer);
    });

    await netA.stop();
    await sleep(500, controller.signal);

    expect(onGoodbyeNetB.callCount).to.equal(1, "netB must receive 1 goodbye");
    const [goodbye, peer] = onGoodbyeNetB.getCall(0).args;
    expect(peer.toB58String()).to.equal(netA.peerId.toB58String(), "netA must be the goodbye requester");
    expect(goodbye).to.equal(BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN), "goodbye reason must be CLIENT_SHUTDOWN");
  });
});
