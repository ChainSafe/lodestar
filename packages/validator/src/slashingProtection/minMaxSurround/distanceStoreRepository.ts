import {Type} from "@chainsafe/ssz";
import {DbBatch, DbReqOpts, encodeKey} from "@lodestar/db";
import {BLSPubkey, Epoch, ssz} from "@lodestar/types";
import {intToBytes} from "@lodestar/utils";
import {Bucket, getBucketNameByValue} from "../../buckets.js";
import {LodestarValidatorDatabaseController} from "../../types.js";
import {DistanceEntry, IDistanceStore, SpanUpdates} from "./interface.js";

/**
 * Manages validator db storage of min/max ranges for min/max surround vote slashing protection.
 */
export class DistanceStoreRepository implements IDistanceStore {
  minSpan: SpanDistanceRepository;
  maxSpan: SpanDistanceRepository;

  constructor(protected db: LodestarValidatorDatabaseController) {
    this.minSpan = new SpanDistanceRepository(db, Bucket.slashingProtectionMinSpanDistance);
    this.maxSpan = new SpanDistanceRepository(db, Bucket.slashingProtectionMaxSpanDistance);
  }

  putOperations(pubkey: BLSPubkey, updates: SpanUpdates): DbBatch<Uint8Array, Uint8Array> {
    return [
      ...this.minSpan.putOperations(pubkey, updates.minSpan),
      ...this.maxSpan.putOperations(pubkey, updates.maxSpan),
    ];
  }

  async setBatch(pubkey: BLSPubkey, updates: SpanUpdates): Promise<void> {
    await this.db.batch(this.putOperations(pubkey, updates), {sync: true});
  }
}

class SpanDistanceRepository {
  protected type: Type<Epoch>;
  protected bucket: Bucket;

  private readonly bucketId: string;
  private readonly dbReqOpts: DbReqOpts;

  constructor(
    protected db: LodestarValidatorDatabaseController,
    bucket: Bucket
  ) {
    this.type = ssz.Epoch;
    this.bucket = bucket;
    this.bucketId = getBucketNameByValue(bucket);
    this.dbReqOpts = {bucketId: this.bucketId};
  }

  async get(pubkey: BLSPubkey, epoch: Epoch): Promise<Epoch | null> {
    const distance = await this.db.get(this.encodeKey(pubkey, epoch), this.dbReqOpts);
    return distance && this.type.deserialize(distance);
  }

  putOperations(pubkey: BLSPubkey, values: DistanceEntry[]): DbBatch<Uint8Array, Uint8Array> {
    return values.map((value) => ({
      type: "put",
      key: this.encodeKey(pubkey, value.source),
      value: this.type.serialize(value.distance),
    }));
  }

  private encodeKey(pubkey: BLSPubkey, epoch: Epoch): Uint8Array {
    return encodeKey(this.bucket, Buffer.concat([pubkey, intToBytes(BigInt(epoch), 8, "be")]));
  }
}
