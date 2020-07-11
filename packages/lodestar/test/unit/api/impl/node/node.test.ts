import {INodeApi} from "../../../../../src/api/impl/node";
import {NodeApi} from "../../../../../src/api/impl/node/node";
import sinon, {SinonStubbedInstance} from "sinon";
import {createPeerId, INetwork, Libp2pNetwork} from "../../../../../src/network";
import {BeaconSync, IBeaconSync} from "../../../../../src/sync";
import {createKeypairFromPeerId, ENR} from "@chainsafe/discv5/lib";
import PeerId from "peer-id";
import {expect} from "chai";
import Multiaddr from "multiaddr";
import {MetadataController} from "../../../../../src/network/metadata";
import {Metadata} from "@chainsafe/lodestar-types";

describe("node api implementation", function () {

  let api: INodeApi;
  let networkStub: SinonStubbedInstance<INetwork>;
  let syncStub: SinonStubbedInstance<IBeaconSync>;

  beforeEach(function () {
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    syncStub = sinon.createStubInstance(BeaconSync);
    api = new NodeApi({}, {network: networkStub, sync: syncStub});
  });

  describe("getNodeIdentity", function () {

    it("should get node identity", async function () {
      const peerId = await PeerId.create({keyType: "secp256k1"});
      const keypair = createKeypairFromPeerId(peerId);
      const enr = ENR.createV4(keypair.publicKey);
      enr.multiaddrTCP = new Multiaddr("/ip4/127.0.0.1/tcp/36001");
      networkStub.getEnr.returns(enr);
      networkStub.peerId = peerId;
      networkStub.metadata = {
        get metadata(): Metadata {
          return {
            attnets: [true],
            seqNumber: BigInt(1)
          };
        }
      } as MetadataController;
      networkStub.multiaddrs = [new Multiaddr("/ip4/127.0.0.1/tcp/36000")];
      const identity = await api.getNodeIdentity();
      expect(identity.peerId.startsWith("16")).to.be.true;
      expect(identity.enr.startsWith("enr:-")).to.be.true;
      expect(identity.discoveryAddresses.length).to.equal(1);
      expect(identity.discoveryAddresses[0]).to.equal("/ip4/127.0.0.1/tcp/36001");
      expect(identity.p2pAddresses.length).to.equal(1);
      expect(identity.p2pAddresses[0]).to.equal("/ip4/127.0.0.1/tcp/36000");
      expect(identity.metadata).to.not.null;
    });

    it("should get node identity - no enr", async function () {
      const peerId = await PeerId.create({keyType: "secp256k1"});
      networkStub.getEnr.returns(null);
      networkStub.peerId = peerId;
      networkStub.multiaddrs = [new Multiaddr("/ip4/127.0.0.1/tcp/36000")];
      const identity = await api.getNodeIdentity();
      expect(identity.enr).equal("");
    });

  });

  describe("getNodeStatus", function () {

    it("syncing", async function () {
      syncStub.isSynced.resolves(false);
      const status = await api.getNodeStatus();
      expect(status).to.equal("syncing");
    });

    it("ready", async function () {
      syncStub.isSynced.resolves(true);
      const status = await api.getNodeStatus();
      expect(status).to.equal("ready");
    });

  });

  describe("getPeers",  function () {
    it("success", async function() {
      const peer1 = await createPeerId();
      const peer2 = await createPeerId();
      networkStub.getPeers.returns([
        peer1,
        peer2
      ]);
      networkStub.getPeerConnection.onFirstCall().returns({
        remoteAddr: new Multiaddr(),
        stat: {
          status: "open",
          direction: "outbound",
        }
      } as LibP2pConnection);
      networkStub.getPeerConnection.onSecondCall().returns({
        remoteAddr: new Multiaddr(),
        stat: {
          status: "closing",
          direction: "inbound",
        }
      } as LibP2pConnection);
      const peers = await api.getPeers();
      expect(peers.length).to.equal(2);
      expect(peers[0].address).not.empty;
      expect(peers[0].peerId).not.empty;
      // expect(peers[0].enr).not.empty;
      expect(peers[0].direction).to.equal("outbound");
      expect(peers[0].state).to.equal("connected");
      expect(peers[1].address).not.empty;
      expect(peers[1].peerId).not.empty;
      // expect(peers[1].enr).not.empty;
      expect(peers[1].direction).to.equal("inbound");
      expect(peers[1].state).to.equal("disconnecting");
    });
  });

  describe("getPeer",  function () {
    it("success", async function() {
      const peer1 = await createPeerId();
      const peer2 = await createPeerId();
      networkStub.getPeers.returns([
        peer1,
        peer2
      ]);
      networkStub.getPeerConnection.onFirstCall().returns({
        remoteAddr: new Multiaddr(),
        stat: {
          status: "open",
          direction: "outbound",
        }
      } as LibP2pConnection);
      networkStub.getPeerConnection.onSecondCall().returns({
        remoteAddr: new Multiaddr(),
        stat: {
          status: "closing",
          direction: "inbound",
        }
      } as LibP2pConnection);
      const peer = await api.getPeer(peer1.toB58String());
      expect(peer.peerId).to.equal(peer1.toB58String());
      expect(peer.address).not.empty;
      expect(peer.peerId).not.empty;
      // expect(peers[0].enr).not.empty;
      expect(peer.direction).to.equal("outbound");
      expect(peer.state).to.equal("connected");
    });

    it("peer not found", async function() {
      const peer1 = await createPeerId();
      const peer2 = await createPeerId();
      networkStub.getPeers.returns([
        peer1,
        peer2
      ]);
      networkStub.getPeerConnection.onFirstCall().returns({
        remoteAddr: new Multiaddr(),
        stat: {
          status: "open",
          direction: "outbound",
        }
      } as LibP2pConnection);
      networkStub.getPeerConnection.onSecondCall().returns({
        remoteAddr: new Multiaddr(),
        stat: {
          status: "closing",
          direction: "inbound",
        }
      } as LibP2pConnection);
      const peer = await api.getPeer("not existent");
      expect(peer).to.be.null;
    });
  });

  describe("getSyncStatus", function () {
    it("success", async function () {
      syncStub.getSyncStatus.resolves({
        headSlot: BigInt(2),
        syncDistance: BigInt(1)
      });
      const syncStatus = await api.getSyncingStatus();
      expect(syncStatus.headSlot.toString()).to.equal("2");
      expect(syncStatus.syncDistance.toString()).to.equal("1");
    });
  });

  describe("getVersion", function () {
    it("success", async function () {
      const version = await api.getVersion();
      expect(version).to.equal("Lodestar/dev");
    });
  });
});
