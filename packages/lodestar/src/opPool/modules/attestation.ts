import {Attestation, BeaconState, CommitteeIndex, Epoch,} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, computeStartSlotAtEpoch,} from "@chainsafe/lodestar-beacon-state-transition";
import {Repository} from "../../db/api/beacon/repositories";
import {OperationsModule} from "./abstract";

export class AttestationOperations extends OperationsModule<Attestation> {
  private readonly config: IBeaconConfig;

  public constructor(db: Repository<Uint8Array, Attestation>, {config}: {config: IBeaconConfig}) {
    super(db);
    this.config = config;
  }

  public async getCommiteeAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]> {
    const attestations = await this.getAll();
    return attestations.filter((attestation) => {
      return attestation.data.index === committeeIndex
          && computeEpochAtSlot(this.config, attestation.data.slot) === epoch
          //filter out aggregated attestations
          && attestation.aggregationBits.length === 1;
    });
  }

  public async geAttestationsByTargetEpoch(epoch: Epoch): Promise<Attestation[]> {
    const attestations = await this.getAll() || [];
    return attestations.filter((attestation) => attestation.data.target.epoch === epoch);
  }

  public async removeOld(state: BeaconState): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, state.finalizedCheckpoint.epoch);
    const attestations: Attestation[] = await this.getAll();
    await this.remove(attestations.filter((a) => {
      return finalizedEpochStartSlot <= a.data.slot;
    }));
  }
}
