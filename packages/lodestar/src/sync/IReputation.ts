/**
 * @module sync
 */
import {Hello, Status} from "@chainsafe/eth2.0-types";

export interface IReputation {
  latestHello: Hello | null;
  latestStatus: Status | null;
  score: number;
}

export class ReputationStore {
  private reputations: Map<string, IReputation>;
  public constructor() {
    this.reputations = new Map<string, IReputation>();
  }
  public add(peerId: string): IReputation {
    const reputation = {
      latestHello: null,
      latestStatus: null,
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
}
