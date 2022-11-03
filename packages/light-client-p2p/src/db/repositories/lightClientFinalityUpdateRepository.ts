import {IChainForkConfig} from "@lodestar/config";
import {Bucket, IDatabaseController, Repository} from "@lodestar/db";
import {altair, Slot, ssz} from "@lodestar/types";

export class LightClientFinalityUpdateRepository extends Repository<Slot, altair.LightClientFinalityUpdate> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>) {
    super(config, db, Bucket.lightClient_finalityUpdate, ssz.altair.LightClientFinalityUpdate);
  }
}
