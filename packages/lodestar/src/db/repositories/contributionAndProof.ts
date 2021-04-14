import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Bucket, IDatabaseController, Repository} from "@chainsafe/lodestar-db";
import {altair, phase0} from "@chainsafe/lodestar-types";

/**
 * Repository for ContributionAndProof.
 * Added via gossip or api.
 * Removed when it's old.
 */
export class ContributionAndProofRepository extends Repository<Uint8Array, altair.ContributionAndProof> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.altair_contributionAndProof, config.types.altair.ContributionAndProof);
  }

  /**
   * Id is hashTreeRoot of SyncCommitteeContribution
   */
  getId(value: altair.ContributionAndProof): Uint8Array {
    return this.config.types.altair.SyncCommitteeContribution.hashTreeRoot(value.contribution);
  }

  async pruneFinalized(finalizedEpoch: phase0.Epoch): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, finalizedEpoch);
    const entries = await this.entries();
    const idsToDelete = entries.filter((e) => e.value.contribution.slot < finalizedEpochStartSlot).map((e) => e.key);
    await this.batchDelete(idsToDelete);
  }
}
