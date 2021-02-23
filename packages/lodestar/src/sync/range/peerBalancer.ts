import PeerId from "peer-id";
import {shuffle} from "../../util/shuffle";
import {sortBy} from "../../util/sortBy";
import {Batch, BatchStatus} from "./batch";

/**
 * Balance and organize peers to perform requests with a SyncChain
 * Shuffles peers only once on instantiation
 */
export class ChainPeersBalancer {
  private peers: PeerId[];
  private activeRequestsByPeer = new PeerMap<number>();

  constructor(peers: PeerId[], batches: Batch[]) {
    this.peers = shuffle(peers);

    // Compute activeRequestsByPeer from all batches internal states
    for (const batch of batches) {
      if (batch.state.status === BatchStatus.Downloading) {
        this.activeRequestsByPeer.set(batch.state.peer, (this.activeRequestsByPeer.get(batch.state.peer) ?? 0) + 1);
      }
    }
  }

  /**
   * Return the most suitable peer to retry
   * Sort peers by (1) no failed request (2) less active requests, then pick first
   */
  bestPeerToRetryBatch(batch: Batch): PeerId | undefined {
    const failedPeers = PeerMap.from(batch.getFailedPeers());
    const sortedBestPeers = sortBy(
      this.peers,
      (peer) => (failedPeers.has(peer) ? 1 : 0),
      (peer) => this.activeRequestsByPeer.get(peer) ?? 0
    );
    return sortedBestPeers[0];
  }

  /**
   * Return peers with 0 or no active requests
   */
  idlePeers(): PeerId[] {
    return this.peers.filter((peer) => !this.activeRequestsByPeer.get(peer));
  }
}

/**
 * Special ES6 Map that allows using PeerId objects as indexers
 * Also, uses a WeakMap to reduce unnecessary calls to `PeerId.toB58String()`
 */
class PeerMap<T> {
  private peerIdStringCache: WeakMap<PeerId, string> = new WeakMap();
  private map: Map<string, T> = new Map();

  static from(peers: PeerId[]): PeerMap<void> {
    const peerMap = new PeerMap<void>();
    for (const peer of peers) peerMap.set(peer);
    return peerMap;
  }

  set(peer: PeerId, value: T): void {
    this.map.set(this.getPeerIdString(peer), value);
  }
  get(peer: PeerId): T | undefined {
    return this.map.get(this.getPeerIdString(peer));
  }
  has(peer: PeerId): boolean {
    return this.map.has(this.getPeerIdString(peer));
  }

  /**
   * Caches peerId.toB58String result in a WeakMap
   */
  private getPeerIdString(peerId: PeerId): string {
    let peerIdString = this.peerIdStringCache.get(peerId);
    if (peerIdString === undefined) {
      peerIdString = peerId.toB58String();
      this.peerIdStringCache.set(peerId, peerIdString);
    }
    return peerIdString;
  }
}
