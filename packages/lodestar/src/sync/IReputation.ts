/**
 * @module sync
 */
import {Hello} from "@chainsafe/eth2.0-types";

export interface IReputation {
  latestHello: Hello | null;
  score: number;
}

export class ReputationStore {
  private reputations: Map<string, IReputation>;
  public constructor() {
    this.reputations = new Map<string, IReputation>();
  }
  public add(peerId: string): IReputation {
    const reputation: IReputation = {
      latestHello: null,
      score: 0
    };
    this.reputations.set(peerId, reputation);
    return reputation;
  }
  public remove(peerId: string): void {
    this.reputations.delete(peerId);
  }
  public get(peerId: string): IReputation {
    return this.reputations.get(peerId) || this.add(peerId);
  }

  public getFromPeerInfo(peer: PeerInfo): IReputation {
    return this.get(peer.id.toB58String());
  }
}
