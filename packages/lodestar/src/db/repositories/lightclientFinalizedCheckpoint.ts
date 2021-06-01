import {SyncPeriod} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";
import {FinalizedCheckpointData} from "@chainsafe/lodestar-light-client/lib/server/LightClientUpdater";
import {ContainerType} from "@chainsafe/ssz";

export class LightclientFinalizedCheckpoint extends Repository<SyncPeriod, FinalizedCheckpointData> {
  constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    // Pick<LightClientUpdate, "header" | "nextSyncCommittee" | "nextSyncCommitteeBranch">
    const type = new ContainerType<FinalizedCheckpointData>({
      fields: {
        header: config.types.altair.LightClientUpdate.getPropertyType("header"),
        nextSyncCommittee: config.types.altair.LightClientUpdate.getPropertyType("nextSyncCommittee"),
        nextSyncCommitteeBranch: config.types.altair.LightClientUpdate.getPropertyType("nextSyncCommitteeBranch"),
      },
    });
    super(config, db, Bucket.altair_lightclientFinalizedCheckpoint, type);
  }

  // Handle key as SyncPeriod

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }
}
