import sinon, {SinonStubbedInstance} from "sinon";
import {PeerId} from "@libp2p/interface-peer-id";
import {expect} from "chai";
import {multiaddr} from "@multiformats/multiaddr";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {createKeypairFromPeerId, SignableENR} from "@chainsafe/discv5";
import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {BeaconSync, IBeaconSync} from "../../../../../src/sync/index.js";
import {INetwork, Network} from "../../../../../src/network/index.js";
import {defaultApiOptions} from "../../../../../src/api/options.js";
import {getNodeApi} from "../../../../../src/api/impl/node/index.js";
import {lodestarNodePeer} from "../../../../utils/node/p2p.js";

type PeerSummary = {
  direction: string | null;
  state: string;
  hasPeerId: boolean;
  hasP2pAddress: boolean;
};

const toPeerSummary = (peer: routes.node.NodePeer): PeerSummary => {
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
      const enr = SignableENR.createV4(keypair);
      enr.setLocationMultiaddr(multiaddr("/ip4/127.0.0.1/tcp/36001"));
      networkStub.getEnr.returns(Promise.resolve(enr));
      networkStub.getMetadata.returns(
        Promise.resolve({
          attnets: BitArray.fromBoolArray([true]),
          syncnets: BitArray.fromBitLen(0),
          seqNumber: BigInt(1),
        })
      );
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
      networkStub.getEnr.returns(Promise.resolve(undefined));
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
      const peers = [
        lodestarNodePeer(peer1, "connected", "outbound"),
        lodestarNodePeer(peer2, "disconnecting", "inbound"),
        lodestarNodePeer(peer3, "disconnected", "inbound"),
      ];

      networkStub.dumpPeers.returns(Promise.resolve(peers));

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
      const allPeers = [
        lodestarNodePeer(peer1, "connected", "outbound"),
        lodestarNodePeer(peer2, "disconnecting", "inbound"),
      ];
      networkStub.dumpPeers.returns(Promise.resolve(allPeers));

      const {data: peers} = await api.getPeers();
      expect(peers.length).to.equal(2);
      expect(peers.map(toPeerSummary)).to.be.deep.equal([
        {direction: "outbound", state: "connected", hasP2pAddress: false, hasPeerId: true},
        {direction: "inbound", state: "disconnecting", hasPeerId: true, hasP2pAddress: false},
      ]);
    });

    it("should return disconnected peers", async function () {
      const allPeers = [
        lodestarNodePeer(peer1, "disconnected", "outbound"),
        lodestarNodePeer(peer2, "disconnected", null),
      ];
      networkStub.dumpPeers.returns(Promise.resolve(allPeers));

      const {data: peers} = await api.getPeers();
      // expect(peers[0].enr).not.empty;
      expect(peers.map(toPeerSummary)).to.be.deep.equal([
        {direction: "outbound", state: "disconnected", hasPeerId: true, hasP2pAddress: false},
        {direction: null, state: "disconnected", hasPeerId: true, hasP2pAddress: false},
      ]);
    });
  });

  describe("getVersion", function () {
    it("success", async function () {
      const {data} = await api.getNodeVersion();
      expect(data.version.startsWith("Lodestar"), `data must start with 'Lodestar': ${data.version}`).to.equal(true);
    });
  });
});
