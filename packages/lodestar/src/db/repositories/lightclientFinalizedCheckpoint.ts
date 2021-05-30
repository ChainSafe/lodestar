import {SyncPeriod} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";
import {FinalizedCheckpointData} from "@chainsafe/lodestar-light-client/lib/server/LightClientUpdater";

export class LightclientFinalizedCheckpoint extends Repository<SyncPeriod, FinalizedCheckpointData> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    const type = config.types.altair.LightClientUpdate;
    super(config, db, Bucket.altair_lightclientFinalizedCheckpoint, type);
  }

  // Handle key as SyncPeriod

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }
}
