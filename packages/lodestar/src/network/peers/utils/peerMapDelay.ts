import PeerId from "peer-id";
import {PeerMap} from "../../../util/peerMap";

/**
 * Maps PeerIds to unix timestamps to implement a timeout map without timeouts
 * Useful to track when a PeerId has to be PING'ed or STATUS'ed
 */
export class PeerMapDelay {
  interval: number;
  lastMsMap = new PeerMap<number>();
  constructor(interval: number) {
    this.interval = interval;
  }

  /** lastMs = 0 -> Request as soon as pollNext() is called */
  requestNow(peer: PeerId): void {
    this.requestAfter(peer, -1);
  }

  /** lastMs = now() -> Request after `INTERVAL` */
  requestAfter(peer: PeerId, ms = this.interval): void {
    this.lastMsMap.set(peer, Date.now() - this.interval + ms);
  }

  /** Return array of peers with expired interval + calls requestAfter on them */
  pollNext(): PeerId[] {
    const peers: PeerId[] = [];
    for (const [peer, lastMs] of this.lastMsMap.entries()) {
      if (Date.now() - lastMs > this.interval) {
        this.requestAfter(peer);
        peers.push(peer);
      }
    }
    return peers;
  }

  delete(peer: PeerId): boolean {
    return this.lastMsMap.delete(peer);
  }
}
