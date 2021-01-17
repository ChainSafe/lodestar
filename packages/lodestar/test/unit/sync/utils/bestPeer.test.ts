import {Root, Status} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import PeerId from "peer-id";
import {getPeersByMostCommonFinalizedCheckpoint, IPeerWithMetadata} from "../../../../src/sync/utils/bestPeers";
import {linspace} from "../../../../src/util/numpy";

describe("sync / utils / bestPeer - getPeersByMostCommonFinalizedCheckpoint", () => {
  it("Should pick the most common finalied checkpoint", () => {
    const root1 = Buffer.alloc(32, 1);
    const root2 = Buffer.alloc(32, 2);

    const peerIds = linspace(0, 10).map((i) => new PeerId(Buffer.from([i])));

    const peers: IPeerWithMetadata[] = [
      // 3 peers for epoch 1 root 1, should loose against higher epoch
      {peerId: peerIds[0], status: generateStatus(1, root1), score: 100},
      {peerId: peerIds[1], status: generateStatus(1, root1), score: 100},
      {peerId: peerIds[2], status: generateStatus(1, root1), score: 100},
      // 2 peers for epoch 1 root 2, should be ignored
      {peerId: peerIds[3], status: generateStatus(1, root2), score: 100},
      {peerId: peerIds[4], status: generateStatus(1, root2), score: 100},
      // 3 peers for epoch 2 root 1, should win
      {peerId: peerIds[5], status: generateStatus(2, root1), score: 100},
      {peerId: peerIds[6], status: generateStatus(2, root1), score: 100},
      {peerId: peerIds[7], status: generateStatus(2, root1), score: 100},
      // 1 peers for epoch 2 root 2, should not be included with above
      {peerId: peerIds[8], status: generateStatus(2, root2), score: 100},
    ];

    const res = getPeersByMostCommonFinalizedCheckpoint(peers);
    if (res === null) throw Error("returned null");

    expect(res.checkpoint.epoch).to.equal(2, "Wrong checkpoint.epoch");
    expect(res.checkpoint.root).to.equal(root1, "Wrong checkpoint.root");
    expect(peersToString(res.peers)).to.deep.equal(peersToString(peers.slice(5, 8)), "Wrong peers");
  });

  it("Should return null when no peers", () => {
    const res = getPeersByMostCommonFinalizedCheckpoint([]);
    expect(res).to.equal(null);
  });

  function generateStatus(finalizedEpoch: number, finalizedRoot: Root): Status {
    return {
      forkDigest: Buffer.alloc(4),
      finalizedRoot,
      finalizedEpoch,
      headRoot: Buffer.alloc(32),
      headSlot: 1,
    };
  }

  function peersToString(peers: IPeerWithMetadata[]): string[] {
    return peers.map((peer) => peer.peerId.toB58String());
  }
});
