import sinon from "sinon";
import {expect} from "chai";
import {PeerId} from "@libp2p/interface/peer-id";
import {config} from "@lodestar/config/default";
import {phase0} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {Network, NetworkEvent, ReqRespMethod} from "../../../src/network/index.js";
import {GoodByeReasonCode} from "../../../src/constants/index.js";
import {connect, disconnect, onPeerConnect, onPeerDisconnect, getNetworkForTest} from "../../utils/network.js";
import {getValidPeerId} from "../../utils/peer.js";

describe("network / main thread", function () {
  runTests.bind(this)({useWorker: false});
});

describe("network / worker", function () {
  runTests.bind(this)({useWorker: true});
});

/* eslint-disable mocha/no-top-level-hooks */

function runTests(this: Mocha.Suite, {useWorker}: {useWorker: boolean}): void {
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

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createTestNode(nodeName: string) {
    const [network, closeAll] = await getNetworkForTest(nodeName, config, {opts: {useWorker}});

    afterEachCallbacks.push(async () => {
      await closeAll();
      sinon.restore();
    });

    return network;
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  async function createTestNodesAB() {
    return Promise.all([createTestNode("A"), createTestNode("B")]);
  }

  it("Disconnect peer", async () => {
    const network = await createTestNode("A");
    await network.disconnectPeer(getValidPeerId().toString());
  });

  it("return getNetworkIdentity", async () => {
    const network = await createTestNode("A");
    const networkIdentity = await network.getNetworkIdentity();
    expect(networkIdentity.peerId).equals(network.peerId.toString());
  });

  it("should create a peer on connect", async function () {
    const [netA, netB] = await createTestNodesAB();
    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
    expect(netA.getConnectedPeerCount()).to.equal(1);
    expect(netB.getConnectedPeerCount()).to.equal(1);
  });

  it("should delete a peer on disconnect", async function () {
    const [netA, netB] = await createTestNodesAB();
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
    const [netA, netB] = await createTestNodesAB();

    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB);
    await connected;

    // Wait some time and stop netA expecting to goodbye netB
    await sleep(500, controller.signal);

    // NetworkEvent.reqRespRequest does not work on worker thread
    // so we only test the peerDisconnected event
    const onGoodbyeNetB = useWorker ? null : sinon.stub<[phase0.Goodbye, PeerId]>();
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
    const netA = await createTestNode("A");

    expect(await getTopics(netA)).deep.equals([]);

    await netA.subscribeGossipCoreTopics();
    expect(await getTopics(netA)).deep.equals([
      "/eth2/18ae4ccb/beacon_block/ssz_snappy",
      "/eth2/18ae4ccb/beacon_aggregate_and_proof/ssz_snappy",
      "/eth2/18ae4ccb/voluntary_exit/ssz_snappy",
      "/eth2/18ae4ccb/proposer_slashing/ssz_snappy",
      "/eth2/18ae4ccb/attester_slashing/ssz_snappy",
    ]);

    await netA.unsubscribeGossipCoreTopics();
    expect(await getTopics(netA)).deep.equals([]);
  });
}

async function getTopics(net: Network): Promise<string[]> {
  return Object.keys(await net.dumpMeshPeers());
}
