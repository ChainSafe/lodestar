import sinon from "sinon";
import {expect} from "chai";

import {PeerId} from "@libp2p/interface-peer-id";
import {multiaddr} from "@multiformats/multiaddr";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {SignableENR} from "@chainsafe/discv5";
import {createBeaconConfig} from "@lodestar/config";
import {config} from "@lodestar/config/default";
import {phase0, ssz} from "@lodestar/types";
import {sleep} from "@lodestar/utils";

import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  Network,
  NetworkEvent,
  NetworkInitModules,
  ReqRespMethod,
  getReqRespHandlers,
} from "../../../src/network/index.js";
import {defaultNetworkOptions, NetworkOptions} from "../../../src/network/options.js";
import {GoodByeReasonCode} from "../../../src/constants/index.js";

import {MockBeaconChain, zeroProtoBlock} from "../../utils/mocks/chain/chain.js";
import {generateState} from "../../utils/state.js";
import {StubbedBeaconDb} from "../../utils/stub/index.js";
import {createNetworkModules, connect, disconnect, onPeerConnect, onPeerDisconnect} from "../../utils/network.js";
import {testLogger} from "../../utils/logger.js";
import {GossipHandlers} from "../../../src/network/gossip/index.js";
import {memoOnce} from "../../utils/cache.js";
import {getValidPeerId} from "../../utils/peer.js";

let port = 9000;
const mu = "/ip4/127.0.0.1/tcp/0";

describe("network / main thread", function () {
  runTests.bind(this)({useWorker: false});
});

describe("network / worker", function () {
  runTests.bind(this)({useWorker: true});
});

/* eslint-disable mocha/no-top-level-hooks */

function runTests(this: Mocha.Suite, opts: {useWorker: boolean}): void {
  this.timeout(50000);
  this.retries(2); // This test fail sometimes, with a 5% rate.

  const afterEachCallbacks: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    await Promise.all(afterEachCallbacks.map((cb) => cb()));
    afterEachCallbacks.splice(0, afterEachCallbacks.length);
  });

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  async function getOpts(peerId: PeerId): Promise<NetworkOptions> {
    const bindAddrUdp = `/ip4/0.0.0.0/udp/${port++}`;
    const enr = SignableENR.createFromPeerId(peerId);
    enr.setLocationMultiaddr(multiaddr(bindAddrUdp));

    return {
      ...defaultNetworkOptions,
      maxPeers: 1,
      targetPeers: 1,
      bootMultiaddrs: [],
      localMultiaddrs: [],
      discv5FirstQueryDelayMs: 0,
      discv5: null,
      useWorker: opts.useWorker,
      skipParamsLog: true,
    };
  }

  const getStaticData = memoOnce(() => {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    const state = generateState({
      finalizedCheckpoint: {
        epoch: 0,
        root: ssz.phase0.BeaconBlock.hashTreeRoot(block.message),
      },
    });
    const beaconConfig = createBeaconConfig(config, state.genesisValidatorsRoot);
    // set genesis time so that we are at ALTAIR_FORK_EPOCH
    // sinon mock timer does not work on worker thread
    state.genesisTime =
      Math.floor(Date.now() / 1000) - beaconConfig.ALTAIR_FORK_EPOCH * beaconConfig.SECONDS_PER_SLOT * SLOTS_PER_EPOCH;
    return {block, state, config: beaconConfig};
  });

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createTestNode(nodeName: string) {
    const {state, config} = getStaticData();
    const chain = new MockBeaconChain({
      genesisTime: state.genesisTime,
      chainId: 0,
      networkId: BigInt(0),
      state,
      config,
    });

    chain.forkChoice.getHead = () => {
      return {
        ...zeroProtoBlock,
        slot: computeStartSlotAtEpoch(config.ALTAIR_FORK_EPOCH),
      };
    };

    const db = new StubbedBeaconDb(config);
    const gossipHandlers = {} as GossipHandlers;

    const peerId = await createSecp256k1PeerId();
    const logger = testLogger(nodeName);

    const opts = await getOpts(peerId);

    const modules: Omit<NetworkInitModules, "opts" | "peerId" | "logger"> = {
      config,
      chain,
      db,
      getReqRespHandler: getReqRespHandlers({db, chain}),
      gossipHandlers,
      signal: controller.signal,
      metrics: null,
    };

    const network = await Network.init({...modules, ...(await createNetworkModules(mu, peerId, opts)), logger});

    afterEachCallbacks.push(async () => {
      await chain.close();
      await network.close();
      controller.abort();
      sinon.restore();
    });

    return {network, chain};
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createTestNodesAB() {
    return Promise.all([createTestNode("A"), createTestNode("B")]);
  }

  it("Disconnect peer", async () => {
    const {network} = await createTestNode("A");
    await network.disconnectPeer(getValidPeerId().toString());
  });

  it("return getNetworkIdentity", async () => {
    const {network} = await createTestNode("A");
    const networkIdentity = await network.getNetworkIdentity();
    expect(networkIdentity.peerId).equals(network.peerId.toString());
  });

  it("should create a peer on connect", async function () {
    const [{network: netA}, {network: netB}] = await createTestNodesAB();
    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
    expect(netA.getConnectedPeerCount()).to.equal(1);
    expect(netB.getConnectedPeerCount()).to.equal(1);
  });

  it("should delete a peer on disconnect", async function () {
    const [{network: netA}, {network: netB}] = await createTestNodesAB();
    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB);
    await connected;

    const disconnection = Promise.all([onPeerDisconnect(netA), onPeerDisconnect(netB)]);
    await sleep(200);

    await disconnect(netA, netB.peerId.toString());
    await disconnection;
    await sleep(400);

    expect(netA.getConnectedPeerCount()).to.equal(0);
    expect(netB.getConnectedPeerCount()).to.equal(0);
  });

  // Current implementation of discv5 consumer doesn't allow to deterministically force a peer to be found
  // a random find node lookup can yield no results if there are too few peers in the DHT
  // it.skip("should connect to new peer by subnet", async function () {});

  it("Should goodbye peers on stop", async function () {
    const [{network: netA}, {network: netB}] = await createTestNodesAB();

    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB);
    await connected;

    // Wait some time and stop netA expecting to goodbye netB
    await sleep(500, controller.signal);

    // NetworkEvent.reqRespRequest does not work on worker thread
    // so we only test the peerDisconnected event
    const onGoodbyeNetB = opts.useWorker ? null : sinon.stub<[phase0.Goodbye, PeerId]>();
    netB.events.on(NetworkEvent.reqRespRequest, ({request, peer}) => {
      if (request.method === ReqRespMethod.Goodbye && onGoodbyeNetB) onGoodbyeNetB(request.body, peer);
    });
    const onDisconnectNetB = sinon.stub<[string]>();
    netB.events.on(NetworkEvent.peerDisconnected, ({peer}) => {
      onDisconnectNetB(peer);
    });

    await netA.close();
    await sleep(500, controller.signal);

    if (onGoodbyeNetB) {
      // this only works on main thread mode
      expect(onGoodbyeNetB.callCount).to.equal(1, "netB must receive 1 goodbye");
      const [goodbye, peer] = onGoodbyeNetB.getCall(0).args;
      expect(peer.toString()).to.equal(netA.peerId.toString(), "netA must be the goodbye requester");
      expect(goodbye).to.equal(BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN), "goodbye reason must be CLIENT_SHUTDOWN");
    }
    const [peer] = onDisconnectNetB.getCall(0).args;
    expect(peer).to.equal(netA.peerId.toString(), "netA must be the goodbye requester");
  });

  it("Should subscribe to gossip core topics on demand", async () => {
    const {network: netA} = await createTestNode("A");

    expect((await getTopics(netA)).length).to.equal(0);
    await netA.subscribeGossipCoreTopics();
    expect((await getTopics(netA)).length).to.equal(13);
    await netA.unsubscribeGossipCoreTopics();
    expect((await getTopics(netA)).length).to.equal(0);
    await netA.close();
  });
}

async function getTopics(net: Network): Promise<string[]> {
  return Object.keys(await net.dumpMeshPeers());
}
