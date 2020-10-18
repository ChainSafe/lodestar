import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {DepositEvent} from "@chainsafe/lodestar-types";
import {IDatabaseController, Bucket, Repository} from "@chainsafe/lodestar-db";

/**
 * DepositData indexed by deposit index
 * Removed when included on chain or old
 */
export class DepositEventRepository extends Repository<number, DepositEvent> {
  public constructor(config: IBeaconConfig, db: IDatabaseController<Buffer, Buffer>) {
    super(config, db, Bucket.depositEvent, config.types.DepositEvent);
  }

  public async deleteOld(depositCount: number): Promise<void> {
    const firstDepositIndex = await this.firstKey();
    if (firstDepositIndex !== 0 && !firstDepositIndex) {
      return;
    }
    await this.batchDelete(Array.from({length: depositCount - firstDepositIndex}, (_, i) => i + firstDepositIndex));
  }

  public async batchPutValues(depositEvents: DepositEvent[]): Promise<void> {
    await this.batchPut(
      depositEvents.map((depositEvent) => ({
        key: depositEvent.index,
        value: depositEvent,
      }))
    );
  }
}
