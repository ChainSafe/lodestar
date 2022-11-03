import {IChainForkConfig} from "@lodestar/config";
import {Bucket, IDatabaseController, Repository} from "@lodestar/db";
import {altair, ssz, SyncPeriod} from "@lodestar/types";

export class LightClientUpdateRepository extends Repository<SyncPeriod, altair.LightClientUpdate> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>) {
    super(config, db, Bucket.lightClient_update, ssz.altair.LightClientUpdate);
  }
}
