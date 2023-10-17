import {describe, it, expect} from "vitest";
import {config} from "@lodestar/config/default";
import {Batch} from "../../../../../src/sync/range/batch.js";
import {ChainPeersBalancer} from "../../../../../src/sync/range/utils/peerBalancer.js";
import {getRandPeerIdStr} from "../../../../utils/peer.js";

describe("sync / range / peerBalancer", () => {
  it("bestPeerToRetryBatch", async () => {
    // Run N times to make sure results are consistent with different shufflings
    for (let i = 0; i < 5; i++) {
      const peer1 = await getRandPeerIdStr();
      const peer2 = await getRandPeerIdStr();
      const peer3 = await getRandPeerIdStr();
      const batch0 = new Batch(0, config);
      const batch1 = new Batch(1, config);

      // Batch zero has a failedDownloadAttempt with peer0
      batch0.startDownloading(peer1);
      batch0.downloadingError();

      // peer2 is busy downloading batch1
      batch1.startDownloading(peer2);

      const peerBalancer = new ChainPeersBalancer([peer1, peer2, peer3], [batch0, batch1]);

      expect(peerBalancer.bestPeerToRetryBatch(batch0)).toBe(peer3);

      batch0.startDownloading(peer3);
      batch0.downloadingError();
      expect(peerBalancer.bestPeerToRetryBatch(batch0)).toBe(peer2);
    }
  });

  it("idlePeers", async () => {
    // Run N times to make sure results are consistent with different shufflings
    for (let i = 0; i < 5; i++) {
      const peer1 = await getRandPeerIdStr();
      const peer2 = await getRandPeerIdStr();
      const peer3 = await getRandPeerIdStr();
      const peer4 = await getRandPeerIdStr();
      const batch0 = new Batch(0, config);
      const batch1 = new Batch(1, config);

      // peer1 and peer2 are busy downloading
      batch0.startDownloading(peer1);
      batch1.startDownloading(peer2);

      const peerBalancer = new ChainPeersBalancer([peer1, peer2, peer3, peer4], [batch0, batch1]);

      const idlePeers = peerBalancer.idlePeers();

      const idlePeersIds = idlePeers.map((p) => p.toString()).sort();
      const expectedIds = [peer3, peer4].map((p) => p.toString()).sort();
      expect(idlePeersIds).toEqual(expectedIds);
    }
  });
});
