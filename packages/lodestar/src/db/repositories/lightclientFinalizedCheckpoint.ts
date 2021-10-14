import {ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, Repository, IDbMetrics} from "@chainsafe/lodestar-db";
import {FinalizedCheckpointData} from "@chainsafe/lodestar-light-client/server";
import {ContainerType} from "@chainsafe/ssz";

export class LightclientFinalizedCheckpoint extends Repository<SyncPeriod, FinalizedCheckpointData> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
    // Pick<LightClientUpdate, "header" | "nextSyncCommittee" | "nextSyncCommitteeBranch">
    const type = new ContainerType<FinalizedCheckpointData>({
      fields: {
        header: ssz.altair.LightClientUpdate.getPropertyType("header"),
        nextSyncCommittee: ssz.altair.LightClientUpdate.getPropertyType("nextSyncCommittee"),
        nextSyncCommitteeBranch: ssz.altair.LightClientUpdate.getPropertyType("nextSyncCommitteeBranch"),
      },
      // Custom type, subset of LightClientUpdate
      casingMap: ssz.altair.LightClientUpdate.casingMap,
    });
    super(config, db, Bucket.altair_lightclientFinalizedCheckpoint, type, metrics);
  }

  // Handle key as SyncPeriod

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }
}
