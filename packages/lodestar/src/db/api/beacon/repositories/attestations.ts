import {FullDatabaseRepository} from "../repository";
import {Attestation} from "../../../../types";
import {IBeaconConfig} from "../../../../config";
import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../../schema";

export class AttestationRepository extends FullDatabaseRepository<Attestation> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController) {
    super(config, db, Bucket.attestation, config.types.Attestation);
  }

}
