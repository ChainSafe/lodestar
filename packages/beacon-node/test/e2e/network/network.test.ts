import {describe, it, expect, afterEach, beforeEach, vi} from "vitest";
import {PeerId} from "@libp2p/interface";
import {config} from "@lodestar/config/default";
import {phase0} from "@lodestar/types";
import {sleep} from "@lodestar/utils";
import {Network, NetworkEvent, ReqRespMethod} from "../../../src/network/index.js";
import {GoodByeReasonCode} from "../../../src/constants/index.js";
import {connect, disconnect, onPeerConnect, onPeerDisconnect} from "../../utils/network.js";
import {getNetworkForTest} from "../../utils/networkWithMockDb.js";
import {getValidPeerId} from "../../utils/peer.js";

describe("network / main thread", function () {
  vi.setConfig({testTimeout: 3000});

  runTests({useWorker: false});
});

describe("network / worker", function () {
  vi.setConfig({testTimeout: 10_000});

  runTests({useWorker: true});
});

function runTests({useWorker}: {useWorker: boolean}): void {
  const afterEachCallbacks: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  let controller: AbortController;

  beforeEach(() => {
    controller = new AbortController();
  });
  afterEach(() => controller.abort());

  async function createTestNode(nodeName: string) {
    const [network, closeAll] = await getNetworkForTest(nodeName, config, {opts: {useWorker}});

    afterEachCallbacks.push(async () => {
      await closeAll();
    });

    return network;
  }

  async function createTestNodesAB(): Promise<[Network, Network]> {
    return Promise.all([
      createTestNode(`network-${useWorker ? "worker" : "main"}-A`),
      createTestNode(`network-${useWorker ? "worker" : "main"}-A`),
    ]);
  }

  it("Disconnect peer", async () => {
    const network = await createTestNode(`network-${useWorker ? "worker" : "main"}-DP`);
    await network.disconnectPeer(getValidPeerId().toString());
  });

  it("return getNetworkIdentity", async () => {
    const network = await createTestNode(`network-${useWorker ? "worker" : "main"}-NI`);
    const networkIdentity = await network.getNetworkIdentity();
    expect(networkIdentity.peerId).toBe(network.peerId.toString());
  });

  it("should create a peer on connect", async function () {
    const [netA, netB] = await createTestNodesAB();
    await Promise.all([onPeerConnect(netA), onPeerConnect(netB), connect(netA, netB)]);
    expect(netA.getConnectedPeerCount()).toBe(1);
    expect(netB.getConnectedPeerCount()).toBe(1);
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

    expect(netA.getConnectedPeerCount()).toBe(0);
    expect(netB.getConnectedPeerCount()).toBe(0);
  });

  // Current implementation of discv5 consumer doesn't allow to deterministically force a peer to be found
  // a random find node lookup can yield no results if there are too few peers in the DHT
  it.todo("should connect to new peer by subnet", async function () {});

  it("Should goodbye peers on stop", async function () {
    const [netA, netB] = await createTestNodesAB();

    const connected = Promise.all([onPeerConnect(netA), onPeerConnect(netB)]);
    await connect(netA, netB);
    await connected;

    // Wait some time and stop netA expecting to goodbye netB
    await sleep(500, controller.signal);

    // NetworkEvent.reqRespRequest does not work on worker thread
    // so we only test the peerDisconnected event
    const onGoodbyeNetB = useWorker ? null : vi.fn<(message: phase0.Goodbye, peerId: PeerId) => void>();
    netB.events.on(NetworkEvent.reqRespRequest, ({request, peer}) => {
      if (request.method === ReqRespMethod.Goodbye && onGoodbyeNetB) onGoodbyeNetB(request.body, peer);
    });
    const onDisconnectNetB = vi.fn<(_: string) => void>();
    netB.events.on(NetworkEvent.peerDisconnected, ({peer}) => {
      onDisconnectNetB(peer);
    });

    await netA.close();
    await sleep(500, controller.signal);

    if (onGoodbyeNetB) {
      // this only works on main thread mode
      expect(onGoodbyeNetB).toHaveBeenCalledOnce();
      const [goodbye, peer] = onGoodbyeNetB.mock.calls[0];
      expect(peer.toString()).toBe(netA.peerId.toString());
      expect(goodbye).toBe(BigInt(GoodByeReasonCode.CLIENT_SHUTDOWN));
    }
    const [peer] = onDisconnectNetB.mock.calls[0];
    expect(peer).toBe(netA.peerId.toString());
  });

  it("Should subscribe to gossip core topics on demand", async () => {
    const netA = await createTestNode(`network-${useWorker ? "worker" : "main"}-CT`);

    expect(await getTopics(netA)).toEqual([]);

    await netA.subscribeGossipCoreTopics();
    expect(await getTopics(netA)).toEqual([
      "/eth2/18ae4ccb/beacon_block/ssz_snappy",
      "/eth2/18ae4ccb/beacon_aggregate_and_proof/ssz_snappy",
      "/eth2/18ae4ccb/voluntary_exit/ssz_snappy",
      "/eth2/18ae4ccb/proposer_slashing/ssz_snappy",
      "/eth2/18ae4ccb/attester_slashing/ssz_snappy",
    ]);

    await netA.unsubscribeGossipCoreTopics();
    expect(await getTopics(netA)).toEqual([]);
  });
}

async function getTopics(net: Network): Promise<string[]> {
  return Object.keys(await net.dumpMeshPeers());
}
