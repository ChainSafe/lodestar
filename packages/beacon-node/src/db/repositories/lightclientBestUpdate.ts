import {IChainForkConfig} from "@lodestar/config";
import {Bucket, IDatabaseController, Repository} from "@lodestar/db";
import {altair, ssz, SyncPeriod} from "@lodestar/types";

/**
 * Best PartialLightClientUpdate in each SyncPeriod
 *
 * Used to prepare light client updates
 */
export class BestLightClientUpdateRepository extends Repository<SyncPeriod, altair.LightClientUpdate> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>) {
    super(config, db, Bucket.lightClient_bestLightClientUpdate, ssz.altair.LightClientUpdate);
  }
}
