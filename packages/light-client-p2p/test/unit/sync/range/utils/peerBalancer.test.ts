import {expect} from "chai";
import {createSecp256k1PeerId} from "@libp2p/peer-id-factory";
import {config} from "@lodestar/config/default";
import {Batch} from "../../../../../src/sync/range/batch.js";
import {ChainPeersBalancer} from "../../../../../src/sync/range/utils/peerBalancer.js";

describe("sync / range / peerBalancer", () => {
  it("bestPeerToRetryBatch", async () => {
    // Run N times to make sure results are consistent with different shufflings
    for (let i = 0; i < 5; i++) {
      const peer1 = await createSecp256k1PeerId();
      const peer2 = await createSecp256k1PeerId();
      const peer3 = await createSecp256k1PeerId();
      const batch0 = new Batch(0, config);
      const batch1 = new Batch(1, config);

      // Batch zero has a failedDownloadAttempt with peer0
      batch0.startDownloading(peer1);
      batch0.downloadingError();

      // peer2 is busy downloading batch1
      batch1.startDownloading(peer2);

      const peerBalancer = new ChainPeersBalancer([peer1, peer2, peer3], [batch0, batch1]);

      expect(peerBalancer.bestPeerToRetryBatch(batch0)).to.equal(
        peer3,
        "peer1 has a failed attempt, and peer2 is busy, best peer to retry batch0 must be peer3"
      );

      batch0.startDownloading(peer3);
      batch0.downloadingError();
      expect(peerBalancer.bestPeerToRetryBatch(batch0)).to.equal(
        peer2,
        "If peer3 also has a failed attempt for batch0, peer2 must become the best"
      );
    }
  });

  it("idlePeers", async () => {
    // Run N times to make sure results are consistent with different shufflings
    for (let i = 0; i < 5; i++) {
      const peer1 = await createSecp256k1PeerId();
      const peer2 = await createSecp256k1PeerId();
      const peer3 = await createSecp256k1PeerId();
      const peer4 = await createSecp256k1PeerId();
      const batch0 = new Batch(0, config);
      const batch1 = new Batch(1, config);

      // peer1 and peer2 are busy downloading
      batch0.startDownloading(peer1);
      batch1.startDownloading(peer2);

      const peerBalancer = new ChainPeersBalancer([peer1, peer2, peer3, peer4], [batch0, batch1]);

      const idlePeers = peerBalancer.idlePeers();

      const idlePeersIds = idlePeers.map((p) => p.toString()).sort();
      const expectedIds = [peer3, peer4].map((p) => p.toString()).sort();
      expect(idlePeersIds).to.deep.equal(expectedIds, "Wrong idlePeers (encoded as B58String)");
    }
  });
});
