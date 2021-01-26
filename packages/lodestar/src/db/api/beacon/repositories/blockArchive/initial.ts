import {GenericBlockArchiveRepository} from "./abstract";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {Bucket, IDatabaseController} from "@chainsafe/lodestar-db";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export class InitialBlockArchiveRepository extends GenericBlockArchiveRepository<SignedBeaconBlock> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.phase0BlockArchive, config.types.SignedBeaconBlock);
  }
}
