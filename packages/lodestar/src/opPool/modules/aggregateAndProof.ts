import {AggregateAndProof, Attestation, BeaconState} from "@chainsafe/eth2.0-types";
import {OperationsModule} from "./abstract";
import {computeStartSlotAtEpoch, isValidAttestationSlot} from "@chainsafe/eth2.0-state-transition";
import {getBitCount} from "../../util/bit";
import {BulkRepository} from "../../db/api/beacon/repository";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export class AggregateAndProofOperations extends OperationsModule<AggregateAndProof> {

  protected config: IBeaconConfig;
  
  public constructor(db: BulkRepository<AggregateAndProof>, {config}: {config: IBeaconConfig}) {
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
      return getBitCount(a.aggregationBits) - getBitCount(b.aggregationBits);
    });
  }

  public async removeOld(state: BeaconState): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, state.finalizedCheckpoint.epoch);
    const aggregates: AggregateAndProof[] = await this.getAll();
    await this.remove(aggregates.filter((a) => {
      return finalizedEpochStartSlot <= a.aggregate.data.slot;
    }));
  }
}
