import {Bucket, encodeKey, IDatabaseApiOptions} from "@chainsafe/lodestar-db";
import {BLSPubkey, Epoch, ssz} from "@chainsafe/lodestar-types";
import {intToBytes} from "@chainsafe/lodestar-utils";
import {Type} from "@chainsafe/ssz";
import {LodestarValidatorDatabaseController} from "../../types.js";
import {IDistanceEntry, IDistanceStore} from "./interface.js";

/**
 * Manages validator db storage of min/max ranges for min/max surround vote slashing protection.
 */
export class DistanceStoreRepository implements IDistanceStore {
  minSpan: SpanDistanceRepository;
  maxSpan: SpanDistanceRepository;

  constructor(opts: IDatabaseApiOptions) {
    this.minSpan = new SpanDistanceRepository(opts, Bucket.index_slashingProtectionMinSpanDistance);
    this.maxSpan = new SpanDistanceRepository(opts, Bucket.index_slashingProtectionMaxSpanDistance);
  }
}

class SpanDistanceRepository {
  protected type: Type<Epoch>;
  protected db: LodestarValidatorDatabaseController;
  protected bucket: Bucket;

  constructor(opts: IDatabaseApiOptions, bucket: Bucket) {
    this.db = opts.controller;
    this.type = ssz.Epoch;
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

  private encodeKey(pubkey: BLSPubkey, epoch: Epoch): Uint8Array {
    return encodeKey(
      this.bucket,
      Buffer.concat([Buffer.from(pubkey as Uint8Array), intToBytes(BigInt(epoch), 8, "be")])
    );
  }
}
