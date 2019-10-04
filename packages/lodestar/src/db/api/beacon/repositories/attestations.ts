import {Attestation} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {BulkRepository, Id} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";
import {hashTreeRoot} from "@chainsafe/ssz";

export class AttestationRepository extends BulkRepository<Attestation> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.attestation, config.types.Attestation);
  }

  public async setUnderRoot(attestation: Attestation): Promise<void> {
    return super.set(hashTreeRoot(attestation.data, this.config.types.AttestationData), attestation);
  }

  public async deleteManyByValue(values: Attestation[]): Promise<void> {
    await this.deleteMany(values.map(value => hashTreeRoot(value.data, this.config.types.AttestationData)));
  }

  public async deleteAll(idFunction?: (value: Attestation) => Id): Promise<void> {
    const data = await this.getAll();
    const defaultIdFunction: (value: Attestation) => Id =
        (value): Id => hashTreeRoot(value.data, this.config.types.AttestationData);
    await this.deleteMany(data.map(idFunction || defaultIdFunction));
  }

}
