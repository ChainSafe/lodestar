import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {phase0, ssz} from "@lodestar/types";
import {Bucket, getBucketNameByValue} from "../buckets.js";

export class DepositTreeSnapshotRepository extends Repository<number, phase0.DepositTreeSnapshot> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.phase0_depositTreeSnapshot;
    super(config, db, bucket, ssz.phase0.DepositTreeSnapshot, getBucketNameByValue(bucket));
  }

  getId(value: phase0.DepositTreeSnapshot): number {
    return value.depositCount;
  }

  /**
   * Only keep the snapshot of the last finalized deposit count
   */
  async deleteOld(finalizedDepositCount: number): Promise<void> {
    const oldKeys = await this.keys({lt: finalizedDepositCount});
    await this.batchDelete(oldKeys);
  }
}
