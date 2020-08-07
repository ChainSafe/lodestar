/**
 * @module sync
 */
import PeerId from "peer-id";
import {Status, Metadata} from "@chainsafe/lodestar-types";
import {ATTESTATION_SUBNET_COUNT, ReqRespEncoding} from "../constants";

export interface IReputation {
  latestStatus: Status | null;
  latestMetadata: Metadata | null;
  score: number;
  encoding: ReqRespEncoding | null;
  supportSync: boolean;
}

export interface IReputationStore {
  add(peerId: string): IReputation;
  remove(peerId: string): void;
  get(peerId: string): IReputation;
  getFromPeerId(peer: PeerId): IReputation;
  getPeerIdsBySubnet(subnetStr: string): string[];
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
      score: 0,
      encoding: null,
      supportSync: false,
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

  public getFromPeerId(peerId: PeerId): IReputation {
    return this.get(peerId.toB58String());
  }

  public getPeerIdsBySubnet(subnetStr: string): string[] {
    if (!new RegExp("^\\d+$").test(subnetStr)) {
      throw new Error(`Invalid subnet ${subnetStr}`);
    }
    const subnet = parseInt(subnetStr);
    if (subnet < 0 || subnet >= ATTESTATION_SUBNET_COUNT) {
      throw new Error(`Invalid subnet ${subnetStr}`);
    }
    const peerIds = [];
    for (const [peerId, rep] of this.reputations) {
      if (rep.latestMetadata && rep.latestMetadata.attnets[subnet]) {
        peerIds.push(peerId);
      }
    }
    return peerIds;
  }
}
