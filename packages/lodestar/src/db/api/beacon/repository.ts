import {AnySSZType, deserialize, hashTreeRoot, serialize} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {IDatabaseController} from "../../controller";
import {Bucket, encodeKey} from "../../schema";

export type Id = Buffer | string | number | bigint;

export abstract class Repository<T> {
  protected config: IBeaconConfig;

  protected db: IDatabaseController;

  protected bucket: Bucket;

  protected type: AnySSZType;

  protected constructor(
    config: IBeaconConfig,
    db: IDatabaseController,
    bucket: Bucket,
    type: AnySSZType) {
    this.config = config;
    this.db = db;
    this.bucket = bucket;
    this.type = type;
  }

  public async get(id: Id): Promise<T | null> {
    try {
      const value = await this.db.get(encodeKey(this.bucket, id));
      if(!value) return null;
      return deserialize(this.type, value);
    } catch (e) {
      return null;
    }
  }

  public async has(id: Id): Promise<boolean> {
    return await this.get(id) !== null;
  }

  public async set(id: Id, value: T): Promise<void> {
    await this.db.put(encodeKey(this.bucket, id), serialize(this.type, value));
  }

  public async delete(id: Id): Promise<void> {
    await this.db.delete(encodeKey(this.bucket, id));
  }

  public getId(value: T): Id {
    return hashTreeRoot(this.type, value);
  }

  public async add(value: T): Promise<void> {
    await this.set(this.getId(value), value);
  }

}

export abstract class BulkRepository<T> extends Repository<T> {

  public async getAll(): Promise<T[]> {
    const data = await this.db.search({
      gt: encodeKey(this.bucket, Buffer.alloc(0)),
      lt: encodeKey(this.bucket + 1, Buffer.alloc(0)),
    });
    return (data || []).map((data) => deserialize(this.type, data));
  }

  public async getAllBetween(lowerLimit: number|null, upperLimit: number|null): Promise<T[]> {
    const data = await this.db.search({
      gt: encodeKey(this.bucket, lowerLimit || Buffer.alloc(0)),
      lt: encodeKey(this.bucket, upperLimit || Number.MAX_SAFE_INTEGER),
    });
    return (data || []).map((data) => deserialize(this.type, data));
  }

  public async deleteMany(ids: Id[]): Promise<void> {
    const criteria: (Buffer | string)[] = [];
    ids.forEach((id) =>
      criteria.push(encodeKey(this.bucket, id))
    );
    await this.db.batchDelete(criteria);
  }

  public async deleteManyByValue(values: T[]): Promise<void> {
    await this.deleteMany(values.map(value => this.getId(value)));
  }

  public async addMany(values: T[]): Promise<void> {
    await this.db.batchPut(
      values.map((value) => ({
        key: encodeKey(this.bucket, this.getId(value)),
        value: serialize(this.type, value),
      }))
    );
  }
}
