import {Attestation} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class AttestationRepository extends Repository<Uint8Array, Attestation> {
  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.attestation, config.types.Attestation);
  }
}
