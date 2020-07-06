import {Attestation, BeaconState, CommitteeIndex, Epoch} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot, computeStartSlotAtEpoch,} from "@chainsafe/lodestar-beacon-state-transition";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";
import {TreeBacked} from "@chainsafe/ssz";

/**
 * Attestation indexed by root
 *
 * Added via gossip or api
 * Removed when included on chain or old
 */
export class AttestationRepository extends Repository<Uint8Array, Attestation> {
  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.attestation, config.types.Attestation);
  }

  public async getCommiteeAttestations(epoch: Epoch, committeeIndex: CommitteeIndex): Promise<Attestation[]> {
    const attestations = await this.values();
    return attestations.filter((attestation) => {
      return attestation.data.index === committeeIndex
          && computeEpochAtSlot(this.config, attestation.data.slot) === epoch
          //filter out aggregated attestations
          && attestation.aggregationBits.length === 1;
    });
  }

  public async geAttestationsByTargetEpoch(epoch: Epoch): Promise<Attestation[]> {
    const attestations = await this.values() || [];
    return attestations.filter((attestation) => attestation.data.target.epoch === epoch);
  }

  public async removeOld(state: TreeBacked<BeaconState>): Promise<void> {
    const finalizedEpochStartSlot = computeStartSlotAtEpoch(this.config, state.finalizedCheckpoint.epoch);
    const attestations: Attestation[] = await this.values();
    await this.batchRemove(attestations.filter((a) => {
      return finalizedEpochStartSlot <= a.data.slot;
    }));
  }
}

