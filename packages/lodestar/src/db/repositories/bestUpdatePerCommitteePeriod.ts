import {altair, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {bytesToInt} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, Repository, IDbMetrics} from "@chainsafe/lodestar-db";

export class BestUpdatePerCommitteePeriod extends Repository<SyncPeriod, altair.LightClientUpdate> {
  constructor(config: IChainForkConfig, db: IDatabaseController<Buffer, Buffer>, metrics?: IDbMetrics) {
    const type = ssz.altair.LightClientUpdate;
    super(config, db, Bucket.altair_bestUpdatePerCommitteePeriod, type, metrics);
  }

  // Handle key as SyncPeriod

  decodeKey(data: Buffer): number {
    return bytesToInt((super.decodeKey(data) as unknown) as Uint8Array, "be");
  }
}
