import {altair, SyncPeriod} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

export class BestUpdatePerCommitteePeriod extends Repository<SyncPeriod, altair.LightClientUpdate> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    const type = config.types.altair.LightClientUpdate;
    super(config, db, Bucket.altair_bestUpdatePerCommitteePeriod, type);
  }

  // Handle key as SyncPeriod

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }
}
