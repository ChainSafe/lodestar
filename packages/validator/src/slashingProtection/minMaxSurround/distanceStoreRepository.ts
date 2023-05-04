import {Bucket, encodeKey, DatabaseApiOptions, DbReqOpts, getBucketNameByValue} from "@lodestar/db";
import {BLSPubkey, Epoch, ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {Type} from "@chainsafe/ssz";
import {LodestarValidatorDatabaseController} from "../../types.js";
import {DistanceEntry, IDistanceStore} from "./interface.js";

/**
 * Manages validator db storage of min/max ranges for min/max surround vote slashing protection.
 */
export class DistanceStoreRepository implements IDistanceStore {
  minSpan: SpanDistanceRepository;
  maxSpan: SpanDistanceRepository;

  constructor(opts: DatabaseApiOptions) {
    this.minSpan = new SpanDistanceRepository(opts, Bucket.index_slashingProtectionMinSpanDistance);
    this.maxSpan = new SpanDistanceRepository(opts, Bucket.index_slashingProtectionMaxSpanDistance);
  }
}

class SpanDistanceRepository {
  protected type: Type<Epoch>;
  protected db: LodestarValidatorDatabaseController;
  protected bucket: Bucket;

  private readonly bucketId: string;
  private readonly dbReqOpts: DbReqOpts;

  constructor(opts: DatabaseApiOptions, bucket: Bucket) {
    this.db = opts.controller;
    this.type = ssz.Epoch;
    this.bucket = bucket;
    this.bucketId = getBucketNameByValue(this.bucket);
    this.dbReqOpts = {bucketId: this.bucketId};
  }

  async get(pubkey: BLSPubkey, epoch: Epoch): Promise<Epoch | null> {
    const distance = await this.db.get(this.encodeKey(pubkey, epoch), this.dbReqOpts);
    return distance && this.type.deserialize(distance);
  }

  async setBatch(pubkey: BLSPubkey, values: DistanceEntry[]): Promise<void> {
    await this.db.batchPut(
      values.map((value) => ({
        key: this.encodeKey(pubkey, value.source),
        value: Buffer.from(this.type.serialize(value.distance)),
      })),
      this.dbReqOpts
    );
  }

  private encodeKey(pubkey: BLSPubkey, epoch: Epoch): Uint8Array {
    return encodeKey(this.bucket, Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(epoch), 8, "be")]));
  }
}
