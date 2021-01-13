import {BLSPubkey, Epoch} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {IDatabaseController, Bucket, encodeKey, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {Type} from "@chainsafe/ssz";
import {IDistanceEntry, IDistanceStore} from "./interface";
import {FORK_VERSION_STUB} from "../const";

export class DistanceStoreRepository implements IDistanceStore {
  minSpan: SpanDistanceRepository;
  maxSpan: SpanDistanceRepository;

  constructor(opts: IDatabaseApiOptions) {
    this.minSpan = new SpanDistanceRepository(opts, Bucket.slashingProtectionMinSpanDistance);
    this.maxSpan = new SpanDistanceRepository(opts, Bucket.slashingProtectionMaxSpanDistance);
  }
}

class SpanDistanceRepository {
  protected type: Type<Epoch>;
  protected db: IDatabaseController<Buffer, Buffer>;
  protected bucket: Bucket;

  constructor(opts: IDatabaseApiOptions, bucket: Bucket) {
    this.db = opts.controller;
    this.type = opts.config.types.Epoch;
    this.bucket = bucket;
  }

  async get(pubkey: BLSPubkey, epoch: Epoch): Promise<Epoch | null> {
    const distance = await this.db.get(this.encodeKey(pubkey, epoch));
    return distance && this.type.deserialize(distance);
  }

  async setBatch(pubkey: BLSPubkey, values: IDistanceEntry[]): Promise<void> {
    await this.db.batchPut(
      values.map((value) => ({
        key: this.encodeKey(pubkey, value.source),
        value: Buffer.from(this.type.serialize(value.distance)),
      }))
    );
  }

  private encodeKey(pubkey: BLSPubkey, epoch: Epoch): Buffer {
    return encodeKey(
      this.bucket,
      FORK_VERSION_STUB,
      Buffer.concat([Buffer.from(pubkey), intToBytes(BigInt(epoch), 8, "be")])
    );
  }
}
