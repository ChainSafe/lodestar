import {IChainForkConfig} from "@lodestar/config";
import {Bucket, IDatabaseController, Repository} from "@lodestar/db";
import {altair, Root, ssz} from "@lodestar/types";

export class LightClientBootstrapRepository extends Repository<Root, altair.LightClientBootstrap> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Uint8Array, Uint8Array>) {
    super(config, db, Bucket.lightClient_bootstrap, ssz.altair.LightClientBootstrap);
  }
}
