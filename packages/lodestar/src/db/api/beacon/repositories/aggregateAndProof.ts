import {ArrayLike} from "@chainsafe/ssz";
import {Attestation, AggregateAndProof, BeaconState, ValidatorIndex, Epoch} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeStartSlotAtEpoch, isValidAttestationSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

/**
 * AggregateAndProof indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AggregateAndProofRepository extends Repository<Uint8Array, AggregateAndProof> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>
  ) {
    super(config, db, Bucket.aggregateAndProof, config.types.AggregateAndProof);
  }

  public async getBlockAttestations(state: BeaconState): Promise<Attestation[]> {
    const aggregates: AggregateAndProof[] = await this.values();
    return aggregates.map(aggregate => aggregate.aggregate).filter((a: Attestation) => {
      //TODO: filter out duplicates
      return isValidAttestationSlot(this.config, a.data.slot, state.slot);
    }).sort((a, b) => {
      //prefer aggregated attestations
      return b.aggregationBits.length - a.aggregationBits.length;
    });
  }

  public async getByAggregatorAndEpoch(aggregatorIndex: ValidatorIndex, epoch: Epoch): Promise<Attestation[]> {
    const aggregates: AggregateAndProof[] = await this.values() || [];
    return aggregates
      .filter((aggregate) => (
        aggregate.aggregate.data.target.epoch === epoch &&
        aggregate.aggregatorIndex === aggregatorIndex
      ))
      .map((aggregate) => aggregate.aggregate);
  }

  public async hasAttestation(attestation: Attestation): Promise<boolean> {
    const aggregates: AggregateAndProof[] = await this.values();
    const index = aggregates.findIndex(
      aggregate => this.config.types.Attestation.equals(aggregate.aggregate, attestation));
    return index !== -1;
  }

  public async removeIncluded(attestations: ArrayLike<Attestation>): Promise<void> {
    const aggregates = await this.values();
    await this.batchRemove(aggregates.filter((a) => {
      return attestations.findIndex((attestation: Attestation) => {
        return this.config.types.Attestation.equals(a.aggregate, attestation);
      });
    }));
  }

  public async removeOld(state: BeaconState): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, state.finalizedCheckpoint.epoch);
    const aggregates: AggregateAndProof[] = await this.values();
    await this.batchRemove(aggregates.filter((a) => {
      return finalizedEpochStartSlot <= a.aggregate.data.slot;
    }));
  }
}
