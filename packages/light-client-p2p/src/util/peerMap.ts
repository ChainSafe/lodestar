import {PeerId} from "@libp2p/interface-peer-id";

export class PeerSet {
  private peerMap = new PeerMap<PeerId>();

  add(peer: PeerId): void {
    this.peerMap.set(peer, peer);
  }
  delete(peer: PeerId): boolean {
    return this.peerMap.delete(peer);
  }
  has(peer: PeerId): boolean {
    return this.peerMap.has(peer);
  }

  get size(): number {
    return this.peerMap.size;
  }
  values(): PeerId[] {
    return this.peerMap.values();
  }
}

/**
 * Special ES6 Map that allows using PeerId objects as indexers
 * Also, uses a WeakMap to reduce unnecessary calls to `PeerId.toString()`
 */
export class PeerMap<T> {
  private map: Map<string, T> = new Map<string, T>();
  private peers: Map<string, PeerId> = new Map<string, PeerId>();

  static from(peers: PeerId[]): PeerMap<void> {
    const peerMap = new PeerMap<void>();
    for (const peer of peers) peerMap.set(peer);
    return peerMap;
  }

  set(peer: PeerId, value: T): void {
    this.peers.set(this.getPeerIdString(peer), peer);
    this.map.set(this.getPeerIdString(peer), value);
  }
  get(peer: PeerId): T | undefined {
    return this.map.get(this.getPeerIdString(peer));
  }
  has(peer: PeerId): boolean {
    return this.map.has(this.getPeerIdString(peer));
  }
  delete(peer: PeerId): boolean {
    this.peers.delete(this.getPeerIdString(peer));
    return this.map.delete(this.getPeerIdString(peer));
  }

  get size(): number {
    return this.map.size;
  }
  keys(): PeerId[] {
    return Array.from(this.peers.values());
  }
  values(): T[] {
    return Array.from(this.map.values());
  }
  entries(): [PeerId, T][] {
    const entries: [PeerId, T][] = [];
    for (const peer of this.peers.values()) {
      const value = this.get(peer);
      if (value !== undefined) entries.push([peer, value]);
    }
    return entries;
  }

  /**
   * Caches peerId.toString result in a WeakMap
   */
  private getPeerIdString(peerId: PeerId): string {
    return peerId.toString();
  }
}
