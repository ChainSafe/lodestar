import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket, encodeKey} from "../../../schema";

/**
 * Stores finalized blocks. Block slot is identifier.
 */
export class BlockArchiveRepository extends BulkRepository<SignedBeaconBlock> {

  public constructor(
    config: IBeaconConfig,
    db: IDatabaseController
  ) {
    super(config, db, Bucket.blockArchive, config.types.SignedBeaconBlock);
  }

  public async addMany(blocks: SignedBeaconBlock[]): Promise<void> {
    await this.db.batchPut(
      blocks.map((block) => ({
        key: encodeKey(this.bucket, this.getId(block)),
        value: this.type.serialize(block)
      }))
    );
  }

  public getId(value: SignedBeaconBlock): Slot {
    return value.message.slot;
  }

  public async getAllBetween(
    lowerLimit: number | null,
    upperLimit: number | null,
    step: number | null = 1
  ): Promise<SignedBeaconBlock[]> {
    const safeLowerLimit = lowerLimit || Buffer.alloc(0);
    const safeUpperLimit = upperLimit || Number.MAX_SAFE_INTEGER;
    const data = await this.db.search({
      gt: encodeKey(this.bucket, safeLowerLimit),
      lt: encodeKey(this.bucket, safeUpperLimit),
    });
    return (data || [])
      .map((datum) => this.type.deserialize(datum))
      .filter(signedBlock => {
        if (step !== null && typeof safeLowerLimit === "number") {
          return signedBlock.message.slot >= safeLowerLimit && (signedBlock.message.slot - safeLowerLimit) % step === 0;
        } else {
          return true;
        }
      });
  }
}
