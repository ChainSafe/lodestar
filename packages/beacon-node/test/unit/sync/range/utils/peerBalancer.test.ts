import {config} from "@lodestar/config/default";
import {describe, expect, it} from "vitest";
import {Batch} from "../../../../../src/sync/range/batch.js";
import {ChainPeersBalancer} from "../../../../../src/sync/range/utils/peerBalancer.js";
import {getRandPeerSyncMeta} from "../../../../utils/peer.js";

describe("sync / range / peerBalancer", () => {
  it("bestPeerToRetryBatch", async () => {
    // Run N times to make sure results are consistent with different shufflings
    for (let i = 0; i < 5; i++) {
      const peer1 = await getRandPeerSyncMeta();
      const peer2 = await getRandPeerSyncMeta();
      const peer3 = await getRandPeerSyncMeta();
      const batch0 = new Batch(0, config);
      const batch1 = new Batch(1, config);

      // Batch zero has a failedDownloadAttempt with peer0
      batch0.startDownloading(peer1.peerId);
      batch0.downloadingError();

      // peer2 is busy downloading batch1
      batch1.startDownloading(peer2.peerId);

      const peerBalancer = new ChainPeersBalancer([peer1, peer2, peer3], [batch0, batch1]);

      expect(peerBalancer.bestPeerToRetryBatch(batch0)?.peerId).toBe(peer3.peerId);

      batch0.startDownloading(peer3.peerId);
      batch0.downloadingError();
      expect(peerBalancer.bestPeerToRetryBatch(batch0)?.peerId).toBe(peer2.peerId);
    }
  });

  it("idlePeers", async () => {
    // Run N times to make sure results are consistent with different shufflings
    for (let i = 0; i < 5; i++) {
      const peer1 = await getRandPeerSyncMeta();
      const peer2 = await getRandPeerSyncMeta();
      const peer3 = await getRandPeerSyncMeta();
      const peer4 = await getRandPeerSyncMeta();
      const batch0 = new Batch(0, config);
      const batch1 = new Batch(1, config);

      // peer1 and peer2 are busy downloading
      batch0.startDownloading(peer1.peerId);
      batch1.startDownloading(peer2.peerId);

      const peerBalancer = new ChainPeersBalancer([peer1, peer2, peer3, peer4], [batch0, batch1]);

      const idlePeers = peerBalancer.idlePeers();

      const idlePeersIds = idlePeers.map((p) => p.peerId.toString()).sort();
      const expectedIds = [peer3, peer4].map((p) => p.peerId.toString()).sort();
      expect(idlePeersIds).toEqual(expectedIds);
    }
  });
});
