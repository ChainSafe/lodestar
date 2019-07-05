/**
 * @module sync
 */
import {Hello, Status} from "@chainsafe/eth2-types";

export interface Reputation {
  latestHello: Hello | null;
  latestStatus: Status | null;
  score: number;
}

export class ReputationStore {
  private reputations: Map<string, Reputation>;
  public constructor() {
    this.reputations = new Map<string, Reputation>();
  }
  public add(peerId: string): Reputation {
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
  public get(peerId: string): Reputation {
    return this.reputations.get(peerId) || this.add(peerId);
  }
}
