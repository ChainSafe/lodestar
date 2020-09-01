import PeerId from "peer-id";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Metadata} from "@chainsafe/lodestar-types";
import {ReputationStore} from "../../../../src/sync/IReputation";
import {updateMetadata, findMissingSubnets, selectPeersToDisconnect, getImportantPeers, handlePeerMetadataSequence} from "../../../../src/sync/utils/reputation";
import {expect} from "chai";
import {Method} from "../../../../src/constants";
import sinon, {SinonStubbedInstance} from "sinon";
import {ReqResp} from "../../../../src/network/reqResp";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {IReqResp, INetwork, Libp2pNetwork} from "../../../../src/network";

describe("handlePeerMetadataSequence", function () {
  let reqRespStub: SinonStubbedInstance<IReqResp>;
  let reps: ReputationStore;
  const logger = new WinstonLogger();
  let peer: PeerId;

  beforeEach(async () => {
    reqRespStub = sinon.createStubInstance(ReqResp);
    reps = new ReputationStore();
    peer = await PeerId.create();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("should not call metadata, peerSeq is null", async () => {
    await handlePeerMetadataSequence(reps, reqRespStub, logger, peer, null);
    expect(reqRespStub.metadata.called).to.be.false;
  });

  it("should not call metadata, peerSeq is same to ReputationStore", async () => {
    reps.getFromPeerId(peer).latestMetadata = {
      seqNumber: BigInt(10),
      attnets: Array(64).fill(true),
    };
    await handlePeerMetadataSequence(reps, reqRespStub, logger, peer, BigInt(10));
    expect(reqRespStub.metadata.called).to.be.false;
  });

  it("should call metadata, peerSeq is bigger than ReputationStore", async () => {
    reps.getFromPeerId(peer).latestMetadata = {
      seqNumber: BigInt(9),
      attnets: Array(64).fill(true),
    };
    await handlePeerMetadataSequence(reps, reqRespStub, logger, peer, BigInt(10));
    expect(reqRespStub.metadata.calledOnce).to.be.true;
  });
});

describe("updateMetadata", function () {
  it("should update metadata, old metadata does not exist", async () => {
    const peer1 = await PeerId.create();
    const metadata: Metadata = {
      seqNumber: BigInt(1),
      attnets: Array(64).fill(true),
    };
    const reps = new ReputationStore();
    updateMetadata(reps, peer1.toB58String(), metadata);
    const updatedMetadata = reps.getFromPeerId(peer1).latestMetadata;
    expect(config.types.Metadata.equals(metadata, updatedMetadata as Metadata)).to.be.true;
  });

  it("should update metadata, new metadata is good", async () => {
    const peer1 = await PeerId.create();
    const oldMetadata: Metadata = {
      seqNumber: BigInt(1),
      attnets: Array(64).fill(false),
    };
    const reps = new ReputationStore();
    reps.getFromPeerId(peer1).latestMetadata = oldMetadata;
    const newMetadata: Metadata = {
      seqNumber: BigInt(10),
      attnets: Array(64).fill(true),
    };
    updateMetadata(reps, peer1.toB58String(), newMetadata);
    const updatedMetadata = reps.getFromPeerId(peer1).latestMetadata;
    expect(config.types.Metadata.equals(newMetadata, updatedMetadata as Metadata)).to.be.true;
  });

  it("should not update metadata, new metadata is not good", async () => {
    const peer1 = await PeerId.create();
    const oldMetadata: Metadata = {
      seqNumber: BigInt(10),
      attnets: Array(64).fill(false),
    };
    const reps = new ReputationStore();
    reps.getFromPeerId(peer1).latestMetadata = oldMetadata;
    const newMetadata: Metadata = {
      seqNumber: BigInt(1),
      attnets: Array(64).fill(true),
    };
    updateMetadata(reps, peer1.toB58String(), newMetadata);
    const latestMetadata = reps.getFromPeerId(peer1).latestMetadata;
    expect(config.types.Metadata.equals(oldMetadata, latestMetadata as Metadata)).to.be.true;
  });
});

describe("findMissingSubnets", function () {
  let networkStub: SinonStubbedInstance<INetwork>;
  beforeEach(() => {
    networkStub = sinon.createStubInstance(Libp2pNetwork);
  });
  afterEach(() => {
    sinon.restore();
  });
  it("should return all subnets, no peer", function () {
    const reps = new ReputationStore();
    networkStub.getPeers.returns([]);
    const missingSubnets = findMissingSubnets(reps, networkStub);
    for (let i = 0; i < 64; i++) {
      expect(missingSubnets[i]).to.be.equal(i);
    }
  });

  it("should return all subnets, peers exist", async function () {
    const reps = new ReputationStore();
    const peers: PeerId[] = [];
    peers.push(await PeerId.create());
    peers.push(await PeerId.create());
    reps.getFromPeerId(peers[0]).latestMetadata = null;
    reps.getFromPeerId(peers[1]).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: Array(64).fill(false),
    };

    networkStub.getPeers.returns(peers.map((peerId) => ({id: peerId} as LibP2p.Peer)));
    const missingSubnets = findMissingSubnets(reps, networkStub);
    for (let i = 0; i < 64; i++) {
      expect(missingSubnets[i]).to.be.equal(i);
    }
  });

  it("should return no missing subnets", async function () {
    const reps = new ReputationStore();
    const peers: PeerId[] = [];
    peers.push(await PeerId.create());
    peers.push(await PeerId.create());
    reps.getFromPeerId(peers[0]).latestMetadata = null;
    reps.getFromPeerId(peers[1]).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: Array(64).fill(true),
    };
    networkStub.getPeers.returns(peers.map((peerId) => ({id: peerId} as LibP2p.Peer)));
    const missingSubnets = findMissingSubnets(reps, networkStub);
    expect(missingSubnets).to.be.deep.equal([]);
  });

  it("should return some missing subnets", async function () {
    const reps = new ReputationStore();
    const peers: PeerId[] = [];
    peers.push(await PeerId.create());
    peers.push(await PeerId.create());
    const attnets0 = Array(64).fill(false);
    attnets0[0] = true;
    attnets0[1] = true;
    reps.getFromPeerId(peers[0]).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: attnets0,
    };
    const attnets1 = Array(64).fill(false);
    attnets1[2] = true;
    attnets1[3] = true;

    reps.getFromPeerId(peers[1]).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: attnets1,
    };
    networkStub.getPeers.returns(peers.map((peerId) => ({id: peerId} as LibP2p.Peer)));
    const missingSubnets = findMissingSubnets(reps, networkStub);
    const expected: number[] = [];
    for (let i = 4; i < 64; i++) {
      expected.push(i);
    }
    expect(missingSubnets).to.be.deep.equal(expected);
  });
});

describe("selectPeersToDisconnect", function () {
  let peer1: PeerId, peer2: PeerId;
  let peers: PeerId[];
  let reps: ReputationStore;
  let networkStub: SinonStubbedInstance<INetwork>;
  beforeEach(async () => {
    peer1 = await PeerId.create();
    peer2 = await PeerId.create();
    peers = [peer1, peer2];
    reps = new ReputationStore();
    networkStub = sinon.createStubInstance(Libp2pNetwork);
    networkStub.getPeers.returns(peers.map((peerId) => ({id: peerId} as LibP2p.Peer)));
  });
  afterEach(() => {
    sinon.restore();
  });

  it("should return important peers", async () => {
    const attnets1 = Array(64).fill(false);
    attnets1[0] = true;
    attnets1[1] = true;
    reps.getFromPeerId(peer1).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: attnets1,
    };
    const attnets2 = Array(64).fill(false);
    attnets2[1] = true;
    reps.getFromPeerId(peer2).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: attnets2,
    };
    const importantPeers = getImportantPeers(peers, reps);
    expect(importantPeers).to.be.deep.equal(new Set([peer1]));
  });

  it("should return empty array, not enough peers to disconnect", async () => {
    // peers are not at 90%
    expect(selectPeersToDisconnect(networkStub, 5, 3, reps)).to.be.deep.equal([]);
  });

  it("should return empty array, no need to disconnect", async () => {
    // still have 3 empty slots for 3 subnets
    expect(selectPeersToDisconnect(networkStub, 3, 5, reps, 0)).to.be.deep.equal([]);
  });

  it("should disconnect unimportant peers", async () => {
    // peer1 is important
    const attnets1 = Array(64).fill(false);
    attnets1[0] = true;
    attnets1[1] = true;
    reps.getFromPeerId(peer1).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: attnets1,
    };
    // peer2 is not imporant
    const attnets2 = Array(64).fill(false);
    attnets2[1] = true;
    reps.getFromPeerId(peer2).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: attnets2,
    };
    // need to disconnect 1 peer and it's peer2
    expect(selectPeersToDisconnect(networkStub, 1, 2, reps, 0)).to.be.deep.equal([peer2]);
  });

  it("should disconnect peers with less supported protocols", async () => {
    networkStub.getPeers.onSecondCall().returns([{id: peer1} as LibP2p.Peer]);
    // need to disconnect 1 peer and it's peer2
    expect(selectPeersToDisconnect(networkStub, 1, 2, reps, 0)).to.be.deep.equal([peer2]);
  });

  it("should disconnect peers without metadata", async () => {
    // don't want to delete peers that are waiting for CheckPeerAlive task
    reps.getFromPeerId(peer1).latestMetadata = {
      attnets: Array(64).fill(false),
      seqNumber: BigInt(1),
    };
    // peer2 has no metadata
    expect(selectPeersToDisconnect(networkStub, 1, 2, reps, 0)).to.be.deep.equal([peer2]);
  });

  it("should disconnect peers that have less subnets", async () => {
    const peer3 = await PeerId.create();
    peers.push(peer3);
    networkStub.getPeers.returns(peers.map((peerId) => ({id: peerId} as LibP2p.Peer)));
    const attnets3 = Array(64).fill(true);
    reps.getFromPeerId(peer3).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: attnets3,
    };
    const attnet1 = Array(64).fill(true);
    attnet1[0] = false;
    reps.getFromPeerId(peer1).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: attnet1,
    };
    const attnet2 = Array(64).fill(true);
    attnet2[0] = false;
    attnet2[1] = false;
    reps.getFromPeerId(peer3).latestMetadata = {
      seqNumber: BigInt(1),
      attnets: attnet2,
    };
    // peer1 and peer2 are all not important but peer1 is connected to more subnets
    // if we have to choose 1 peer to disconnect, it's peer2
    expect(selectPeersToDisconnect(networkStub, 1, 3, reps, 0)).to.be.deep.equal([peer2]);
  });
});
