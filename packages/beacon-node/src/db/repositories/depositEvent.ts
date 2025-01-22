import {ChainForkConfig} from "@lodestar/config";
import {Db, Repository} from "@lodestar/db";
import {phase0, ssz} from "@lodestar/types";
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

  async deleteOld(depositCount: number): Promise<number> {
    const firstDepositIndex = await this.firstKey();
    if (firstDepositIndex === null) {
      return 0;
    }

    const length = depositCount - firstDepositIndex;
    await this.batchDelete(Array.from({length}, (_, i) => i + firstDepositIndex));
    return length;
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
