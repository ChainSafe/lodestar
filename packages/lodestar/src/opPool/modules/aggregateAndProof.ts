import {ArrayLike} from "@chainsafe/ssz";
import {AggregateAndProof, Attestation, BeaconState, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeStartSlotAtEpoch, isValidAttestationSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {OperationsModule} from "./abstract";
import {Repository} from "../../db/api/beacon/repositories";

export class AggregateAndProofOperations extends OperationsModule<AggregateAndProof> {

  protected config: IBeaconConfig;

  public constructor(db: Repository<Uint8Array, AggregateAndProof>, {config}: {config: IBeaconConfig}) {
    super(db);
    this.config = config;
  }

  public async getBlockAttestations(state: BeaconState): Promise<Attestation[]> {
    const aggregates: AggregateAndProof[] = await this.getAll();
    return aggregates.map(aggregate => aggregate.aggregate).filter((a: Attestation) => {
      //TODO: filter out duplicates
      return isValidAttestationSlot(this.config, a.data.slot, state.slot);
    }).sort((a, b) => {
      //prefer aggregated attestations
      return a.aggregationBits.length - b.aggregationBits.length;
    });
  }

  public async getByAggregatorAndSlot(aggregatorIndex: ValidatorIndex, slot: Slot): Promise<Attestation[]> {
    const aggregates: AggregateAndProof[] = await this.getAll() || [];
    return aggregates
      .filter((aggregate) => aggregate.aggregate.data.slot === slot && aggregate.aggregatorIndex === aggregatorIndex)
      .map((aggregate) => aggregate.aggregate);
  }

  public async hasAttestation(attestation: Attestation): Promise<boolean> {
    const aggregates: AggregateAndProof[] = await this.getAll();
    const index = aggregates.findIndex(
      aggregate => this.config.types.Attestation.equals(aggregate.aggregate, attestation));
    return index !== -1;
  }

  public async removeIncluded(attestations: ArrayLike<Attestation>): Promise<void> {
    const aggregates = await this.getAll();
    await this.remove(aggregates.filter((a) => {
      return attestations.findIndex((attestation: Attestation) => {
        return this.config.types.Attestation.equals(a.aggregate, attestation);
      });
    }));
  }

  public async removeOld(state: BeaconState): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, state.finalizedCheckpoint.epoch);
    const aggregates: AggregateAndProof[] = await this.getAll();
    await this.remove(aggregates.filter((a) => {
      return finalizedEpochStartSlot <= a.aggregate.data.slot;
    }));
  }
}
