import { BeaconBlock } from "@chainsafe/eth2.0-types";
import { IBeaconConfig } from "@chainsafe/eth2.0-config";
import { BulkRepository } from "../repository";
import { IDatabaseController } from "../../../controller";
import { Bucket, encodeKey } from "../../../schema";
import { serialize, deserialize } from "@chainsafe/ssz";

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository extends BulkRepository<BeaconBlock> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController
  ) {
    super(config, db, Bucket.blockArchive, config.types.BeaconBlock);
  }

  public async addMany(blocks: BeaconBlock[]): Promise<void> {
    await this.db.batchPut(
      blocks.map((block) => ({
        key: encodeKey(this.bucket, block.slot),
        value: serialize(this.type, block)
      }))
    );
  }

  public async add(value: BeaconBlock): Promise<void> {
    return this.set(value.slot, value);
  }

  public async getAllBetween(
    lowerLimit: number | null,
    upperLimit: number | null,
    step: number | null = 1
  ): Promise<BeaconBlock[]> {
    const safeLowerLimit = lowerLimit || Buffer.alloc(0);
    const safeUpperLimit = upperLimit || Number.MAX_SAFE_INTEGER;
    const data = await this.db.search({
      gt: encodeKey(this.bucket, safeLowerLimit),
      lt: encodeKey(this.bucket, safeUpperLimit),
    });
    const processedData = (data || [])
      .map((datum) => deserialize(this.type, datum))
      .filter(block => {
        if (step !== null && typeof safeLowerLimit === "number") {
          return block.slot >= safeLowerLimit && (block.slot - safeLowerLimit) % step === 0;
        } else {
          return true;
        }
      });
    return processedData;
  }
}
