import {ArrayLike, TreeBacked} from "@chainsafe/ssz";
import {phase0, ValidatorIndex, Epoch} from "@chainsafe/lodestar-types";
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
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.aggregateAndProof, config.types.phase0.AggregateAndProof);
  }

  /**
   * Id is hashTreeRoot of aggregated attestation
   */
  public getId(value: phase0.AggregateAndProof): Uint8Array {
    return this.config.types.phase0.Attestation.hashTreeRoot(value.aggregate);
  }

  public async getBlockAttestations(state: TreeBacked<phase0.BeaconState>): Promise<phase0.Attestation[]> {
    const aggregates: phase0.AggregateAndProof[] = await this.values();
    return aggregates
      .map((aggregate) => aggregate.aggregate)
      .filter((a: phase0.Attestation) => {
        //TODO: filter out duplicates
        return isValidAttestationSlot(this.config, a.data.slot, state.slot);
      })
      .sort((a, b) => {
        // prefer aggregated attestations
        return b.aggregationBits.length - a.aggregationBits.length;
      });
  }

  public async getByAggregatorAndEpoch(aggregatorIndex: ValidatorIndex, epoch: Epoch): Promise<phase0.Attestation[]> {
    const aggregates: phase0.AggregateAndProof[] = (await this.values()) || [];
    return aggregates
      .filter(
        (aggregate) => aggregate.aggregate.data.target.epoch === epoch && aggregate.aggregatorIndex === aggregatorIndex
      )
      .map((aggregate) => aggregate.aggregate);
  }

  public async hasAttestation(attestation: phase0.Attestation): Promise<boolean> {
    const id = this.config.types.phase0.Attestation.hashTreeRoot(attestation);
    const found = await this.get(id);
    return !!found;
  }

  public async removeIncluded(attestations: ArrayLike<phase0.Attestation>): Promise<void> {
    const ids: Uint8Array[] = [];
    for (const attestation of attestations) {
      ids.push(this.config.types.phase0.Attestation.hashTreeRoot(attestation));
    }

    await this.batchDelete(ids);
  }

  public async pruneFinalized(finalizedEpoch: Epoch): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, finalizedEpoch);
    const aggregates: phase0.AggregateAndProof[] = await this.values();
    await this.batchRemove(
      aggregates.filter((a) => {
        return a.aggregate.data.slot < finalizedEpochStartSlot;
      })
    );
  }
}
