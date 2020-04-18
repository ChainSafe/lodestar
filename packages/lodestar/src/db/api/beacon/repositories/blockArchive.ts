import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BulkRepository} from "../repository";
import {IDatabaseController} from "../../../controller";
import {Bucket, encodeKey} from "../../../schema";
import {isEligibleBlock} from "./util";

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
    const result = [];
    for await (const signedBlock of this.getAllBetweenStream(lowerLimit, upperLimit, step)) {
      result.push(signedBlock);
    }
    return result;
  }

  public getAllBetweenStream(
    lowerLimit: number | null,
    upperLimit: number | null,
    step: number | null = 1
  ): AsyncGenerator<SignedBeaconBlock> {
    let safeLowerLimit;
    if(lowerLimit === null) {
      safeLowerLimit = Buffer.alloc(0);
    } else {
      safeLowerLimit = lowerLimit;
    }
    const safeUpperLimit = upperLimit || Number.MAX_SAFE_INTEGER;
    const dataStream = this.db.searchStream({
      gt: encodeKey(this.bucket, safeLowerLimit),
      lt: encodeKey(this.bucket, safeUpperLimit),
    });
    const deserialize = this.type.deserialize.bind(this.type);
    return (async function * () {
      for await (const data of dataStream) {
        const block = deserialize(data);
        if (isEligibleBlock(block, step, safeLowerLimit)) {
          yield block;
        }
      }
    })();
  }
}
