import {Attestation, CommitteeIndex, Epoch} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";
import {computeEpochAtSlot} from "@chainsafe/eth2.0-state-transition";

export class WireAttestationRepository extends BulkRepository<Attestation> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.wireAttestation, config.types.Attestation);
  }

  public async getCommiteeAttestations(epoch: Epoch, index: CommitteeIndex): Promise<Attestation[]> {
    const allWireAttestations = await this.getAll();
    return allWireAttestations.filter((attestation) => {
      return attestation.data.index === index
          && computeEpochAtSlot(this.config, attestation.data.slot);
    });
  }
}
