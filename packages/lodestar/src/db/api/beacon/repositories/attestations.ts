import {BulkRepository} from "../repository";
import {Attestation} from "../../../../types";
import {IBeaconConfig} from "../../../../config";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class AttestationRepository extends BulkRepository<Attestation> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.attestation, config.types.Attestation);
  }

}
