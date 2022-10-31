/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {Connection} from "@libp2p/interface-connection";
import sinon, {SinonStubbedInstance} from "sinon";
import {PeerId} from "@libp2p/interface-peer-id";
import {expect} from "chai";
import {multiaddr} from "@multiformats/multiaddr";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {createKeypairFromPeerId, ENR} from "@chainsafe/discv5";
import {BitArray} from "@chainsafe/ssz";
import {altair} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {BeaconSync, IBeaconSync} from "../../../../../src/sync/index.js";
import {INetwork, Network} from "../../../../../src/network/index.js";
import {MetadataController} from "../../../../../src/network/metadata.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {getNodeApi} from "../../../../../src/api/impl/node/index.js";
import {libp2pConnection} from "../../../../utils/node/p2p.js";

interface IPeerSummary {
  direction: string | null;
  state: string;
  hasPeerId: boolean;
  hasP2pAddress: boolean;
}

const toPeerSummary = (peer: routes.node.NodePeer): IPeerSummary => {
  return {
    direction: peer.direction,
    state: peer.state,
    hasPeerId: !peer.peerId ? false : peer.peerId.length > 0,
    hasP2pAddress: !peer.lastSeenP2pAddress ? false : peer.lastSeenP2pAddress.length > 0,
  };
};

describe("node api implementation", function () {
  let api: ReturnType<typeof getNodeApi>;
  let networkStub: SinonStubbedInstance<INetwork>;
  let syncStub: SinonStubbedInstance<IBeaconSync>;
  let peerId: PeerId;

  beforeEach(async function () {
    networkStub = sinon.createStubInstance(Network);
    syncStub = sinon.createStubInstance(BeaconSync);
    api = getNodeApi(defaultApiOptions, {network: networkStub, sync: syncStub});
    peerId = await createSecp256k1PeerId();
    sinon.stub(networkStub, "peerId").get(() => peerId);
    sinon.stub(networkStub, "localMultiaddrs").get(() => [multiaddr("/ip4/127.0.0.1/tcp/36000")]);
  });

  describe("getNetworkIdentity", function () {
    it("should get node identity", async function () {
      const keypair = createKeypairFromPeerId(peerId);
      const enr = ENR.createV4(keypair.publicKey);
      enr.setLocationMultiaddr(multiaddr("/ip4/127.0.0.1/tcp/36001"));
      networkStub.getEnr.returns(enr);
      networkStub.metadata = {
        get json(): altair.Metadata {
          return {
            attnets: BitArray.fromBoolArray([true]),
            syncnets: BitArray.fromBitLen(0),
            seqNumber: BigInt(1),
          };
        },
      } as MetadataController;
      const {data: identity} = await api.getNetworkIdentity();
      expect(identity.peerId.startsWith("16")).to.equal(true);
      expect(identity.enr.startsWith("enr:-")).to.equal(true);
      expect(identity.discoveryAddresses.length).to.equal(1);
      expect(identity.discoveryAddresses[0]).to.equal("/ip4/127.0.0.1/tcp/36001");
      expect(identity.p2pAddresses.length).to.equal(1);
      expect(identity.p2pAddresses[0]).to.equal("/ip4/127.0.0.1/tcp/36000");
      expect(identity.metadata).to.not.null;
    });

    it("should get node identity - no enr", async function () {
      networkStub.getEnr.returns((null as unknown) as ENR);
      const {data: identity} = await api.getNetworkIdentity();
      expect(identity.enr).equal("");
    });
  });

  describe("getPeerCount", function () {
    let peer1: PeerId, peer2: PeerId, peer3: PeerId;

    before(async function () {
      peer1 = await createSecp256k1PeerId();
      peer2 = await createSecp256k1PeerId();
      peer3 = await createSecp256k1PeerId();
    });

    it("it should return peer count", async function () {
      const connectionsByPeer = new Map<string, Connection[]>([
        [peer1.toString(), [libp2pConnection(peer1, "OPEN", "outbound")]],
        [
          peer2.toString(),
          [libp2pConnection(peer2, "CLOSING", "inbound"), libp2pConnection(peer2, "CLOSING", "inbound")],
        ],
        [
          peer3.toString(),
          [
            libp2pConnection(peer3, "CLOSED", "inbound"),
            libp2pConnection(peer3, "CLOSED", "inbound"),
            libp2pConnection(peer3, "CLOSED", "inbound"),
          ],
        ],
      ]);

      networkStub.getConnectionsByPeer.returns(connectionsByPeer);

      const {data: count} = await api.getPeerCount();
      expect(count).to.be.deep.equal(
        {
          connected: 1,
          disconnecting: 1, // picks most relevant connection to count
          disconnected: 1, // picks most relevant connection to count
          connecting: 0,
        },
        "getPeerCount incorrect"
      );
    });
  });

  describe("getPeers", function () {
    let peer1: PeerId, peer2: PeerId;

    before(async function () {
      peer1 = await createSecp256k1PeerId();
      peer2 = await createSecp256k1PeerId();
    });

    it("should return connected and disconnecting peers", async function () {
      const connectionsByPeer = new Map<string, Connection[]>([
        [peer1.toString(), [libp2pConnection(peer1, "OPEN", "outbound")]],
        [peer2.toString(), [libp2pConnection(peer2, "CLOSING", "inbound")]],
      ]);
      networkStub.getConnectionsByPeer.returns(connectionsByPeer);

      const {data: peers} = await api.getPeers();
      expect(peers.length).to.equal(2);
      expect(peers.map(toPeerSummary)).to.be.deep.equal([
        {direction: "outbound", state: "connected", hasP2pAddress: true, hasPeerId: true},
        {direction: "inbound", state: "disconnecting", hasPeerId: true, hasP2pAddress: true},
      ]);
    });

    it("should return disconnected peers", async function () {
      const connectionsByPeer = new Map<string, Connection[]>([
        [peer1.toString(), [libp2pConnection(peer1, "CLOSED", "outbound")]],
        [peer2.toString(), []], // peer2 has no connections in the connection manager
      ]);
      networkStub.getConnectionsByPeer.returns(connectionsByPeer);

      const {data: peers} = await api.getPeers();
      // expect(peers[0].enr).not.empty;
      expect(peers.map(toPeerSummary)).to.be.deep.equal([
        {direction: "outbound", state: "disconnected", hasPeerId: true, hasP2pAddress: true},
        {direction: null, state: "disconnected", hasPeerId: true, hasP2pAddress: false},
      ]);
    });
  });

  describe("getPeer", function () {
    it("success", async function () {
      const peer1 = await createSecp256k1PeerId();
      const peer2 = await createSecp256k1PeerId();
      const connectionsByPeer = new Map<string, Connection[]>([
        [peer1.toString(), [libp2pConnection(peer1, "OPEN", "outbound")]],
        [peer2.toString(), [libp2pConnection(peer2, "CLOSING", "inbound")]],
      ]);
      networkStub.getConnectionsByPeer.returns(connectionsByPeer);

      const {data: peer} = await api.getPeer(peer1.toString());
      if (peer === undefined) throw Error("getPeer returned no peer");
      expect(peer.peerId).to.equal(peer1.toString());
      expect(peer.lastSeenP2pAddress).not.empty;
      expect(peer.peerId).not.empty;
      // expect(peers[0].enr).not.empty;
      expect(peer.direction).to.equal("outbound");
      expect(peer.state).to.equal("connected");
    });

    it("peer not found", async function () {
      const connectionsByPeer = new Map<string, Connection[]>();
      networkStub.getConnectionsByPeer.returns(connectionsByPeer);
      await expect(api.getPeer("not existent")).to.be.rejectedWith();
    });
  });

  describe("getVersion", function () {
    it("success", async function () {
      const {data} = await api.getNodeVersion();
      expect(data.version.startsWith("Lodestar"), `data must start with 'Lodestar': ${data.version}`).to.equal(true);
    });
  });
});
