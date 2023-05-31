import {ChainForkConfig} from "@lodestar/config";
import {phase0, ssz} from "@lodestar/types";
import {Db, Repository} from "@lodestar/db";
import {Bucket, getBucketNameByValue} from "../buckets.js";

/**
 * DepositData indexed by deposit index
 * Removed when included on chain or old
 */
export class DepositEventRepository extends Repository<number, phase0.DepositEvent> {
  constructor(config: ChainForkConfig, db: Db) {
    const bucket = Bucket.phase0_depositEvent;
    super(config, db, bucket, ssz.phase0.DepositEvent, getBucketNameByValue(bucket));
  }

  async deleteOld(depositCount: number): Promise<void> {
    const firstDepositIndex = await this.firstKey();
    if (firstDepositIndex === null) {
      return;
    }
    await this.batchDelete(Array.from({length: depositCount - firstDepositIndex}, (_, i) => i + firstDepositIndex));
  }

  async batchPutValues(depositEvents: phase0.DepositEvent[]): Promise<void> {
    await this.batchPut(
      depositEvents.map((depositEvent) => ({
        key: depositEvent.index,
        value: depositEvent,
      }))
    );
  }
}
