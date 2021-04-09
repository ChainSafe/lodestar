import {ArrayLike} from "@chainsafe/ssz";
import {phase0, Epoch} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeStartSlotAtEpoch, isValidAttestationSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

/**
 * AggregateAndProof indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AggregateAndProofRepository extends Repository<Uint8Array, phase0.AggregateAndProof> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.phase0_aggregateAndProof, config.types.phase0.AggregateAndProof);
  }

  /**
   * Id is hashTreeRoot of aggregated attestation
   */
  getId(value: phase0.AggregateAndProof): Uint8Array {
    return this.config.types.phase0.Attestation.hashTreeRoot(value.aggregate);
  }

  async getBlockAttestations(state: phase0.BeaconState): Promise<phase0.Attestation[]> {
    const aggregates: phase0.AggregateAndProof[] = await this.values();
    return aggregates
      .map((aggregate) => aggregate.aggregate)
      .filter((a: phase0.Attestation) => {
        // Attestation should be unique because we store by its id
        return isValidAttestationSlot(this.config, a.data.slot, state.slot);
      })
      .sort((a, b) => {
        // prefer attestations with more participants
        return (
          Array.from(b.aggregationBits).filter((bit) => bit).length -
          Array.from(a.aggregationBits).filter((bit) => bit).length
        );
      });
  }

  async removeIncluded(attestations: ArrayLike<phase0.Attestation>): Promise<void> {
    const ids: Uint8Array[] = [];
    for (const attestation of attestations) {
      ids.push(this.config.types.phase0.Attestation.hashTreeRoot(attestation));
    }

    await this.batchDelete(ids);
  }

  async pruneFinalized(finalizedEpoch: Epoch): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, finalizedEpoch);
    const entries = await this.entries();
    const idsToDelete = entries.filter((e) => e.value.aggregate.data.slot < finalizedEpochStartSlot).map((e) => e.key);
    await this.batchDelete(idsToDelete);
  }
}
