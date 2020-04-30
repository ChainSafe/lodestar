import {AttesterSlashing} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IDatabaseController} from "../../../controller";
import {Bucket} from "../../schema";
import {Repository} from "./abstract";

export class AttesterSlashingRepository extends Repository<Uint8Array, AttesterSlashing> {
  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController<Buffer, Buffer>,
  ) {
    super(config, db, Bucket.attesterSlashing, config.types.AttesterSlashing);
  }
}
