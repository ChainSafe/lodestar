/**
 * @module sync
 */
import {Status, Metadata} from "@chainsafe/lodestar-types";

export interface IReputation {
  latestStatus: Status | null;
  latestMetadata: Metadata | null;
  score: number;
}

export interface IReputationStore {
  add(peerId: string): IReputation;
  remove(peerId: string): void;
  get(peerId: string): IReputation;
  getFromPeerInfo(peer: PeerInfo): IReputation;
}

export class ReputationStore implements IReputationStore {
  private reputations: Map<string, IReputation>;
  public constructor() {
    this.reputations = new Map<string, IReputation>();
  }
  public add(peerId: string): IReputation {
    const reputation: IReputation = {
      latestStatus: null,
      latestMetadata: null,
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
