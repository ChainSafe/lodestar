import {GenericBlockArchiveRepository} from "./abstract";
import {Lightclient} from "@chainsafe/lodestar-types";
import {Bucket, IDatabaseController} from "@chainsafe/lodestar-db";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export class LightclientBlockArchiveRepository extends GenericBlockArchiveRepository<Lightclient.SignedBeaconBlock> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.lightclientBlockArchive, config.types.lightclient.SignedBeaconBlock);
  }
}
