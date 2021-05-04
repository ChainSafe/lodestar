import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair} from "@chainsafe/lodestar-types";

/**
 * Used to verify gossip SyncCommitteeSignature. When there are multiple
 * items from same validator
 */
export class SeenSyncCommitteeCache {
  private cache: Map<string, boolean>;
  private readonly config: IBeaconConfig;
  private readonly maxSize: number;

  constructor(config: IBeaconConfig, maxSize = 1000) {
    this.config = config;
    this.maxSize = maxSize;
    this.cache = new Map<string, boolean>();
  }

  addSyncCommitteeSignature(syncCommittee: altair.SyncCommitteeSignature): void {
    const key = this.syncCommitteeKey(syncCommittee);
    this.add(key);
  }

  addContributionAndProof(contributionAndProof: altair.ContributionAndProof): void {
    const key = this.contributionAndProofKey(contributionAndProof);
    this.add(key);
  }

  hasSyncCommitteeSignature(syncCommittee: altair.SyncCommitteeSignature): boolean {
    const key = this.syncCommitteeKey(syncCommittee);
    return this.cache.has(key);
  }

  hasContributionAndProof(contributionAndProof: altair.ContributionAndProof): boolean {
    const key = this.contributionAndProofKey(contributionAndProof);
    return this.cache.has(key);
  }

  private syncCommitteeKey(syncCommittee: altair.SyncCommitteeSignature): string {
    return "sync_committee" + syncCommittee.slot + "_" + syncCommittee.validatorIndex;
  }

  private contributionAndProofKey(contributionAndProof: altair.ContributionAndProof): string {
    const {slot, subCommitteeIndex} = contributionAndProof.contribution;
    return "contribution_and_proof" + contributionAndProof.aggregatorIndex + "_" + slot + "_" + subCommitteeIndex;
  }

  private add(key: string): void {
    this.cache.set(key, true);
    if (this.cache.size > this.maxSize) {
      // deletes oldest element added (map keep list of insert order)
      this.cache.delete(this.cache.keys().next().value);
    }
  }
}
