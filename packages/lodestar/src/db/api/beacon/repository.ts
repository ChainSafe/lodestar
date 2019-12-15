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
      if (!value) return null;
      return deserialize(value, this.type);
    } catch (e) {
      return null;
    }
  }

  public async has(id: Id): Promise<boolean> {
    return await this.get(id) !== null;
  }

  public async add(value: T): Promise<void> {
    await this.set(hashTreeRoot(value, this.type), value);
  }

  public async set(id: Id, value: T): Promise<void> {
    await this.db.put(encodeKey(this.bucket, id), serialize(value, this.type));
  }

  public async delete(id: Id): Promise<void> {
    await this.db.delete(encodeKey(this.bucket, id));
  }

}

export abstract class BulkRepository<T> extends Repository<T> {

  public async getAll(): Promise<T[]> {
    const data = await this.db.search({
      gt: encodeKey(this.bucket, Buffer.alloc(0)),
      lt: encodeKey(this.bucket + 1, Buffer.alloc(0)),
    });
    return (data || []).map((data) => deserialize(data, this.type));
  }

  public async getAllBetween(lowerLimit: number|null, upperLimit: number|null, step: number|null = null): Promise<T[]> {
    const data = await this.db.search({
      gt: encodeKey(this.bucket, lowerLimit || Buffer.alloc(0)),
      lt: encodeKey(this.bucket, upperLimit || Number.MAX_SAFE_INTEGER),
    });
    let processedData = data;
    if (step !== null) {
      processedData = data.filter((datum, index) => {
        return index % step === 0;
      });
    }
    return (processedData || []).map((processedData) => deserialize(processedData, this.type));
  }

  public async deleteMany(ids: Id[]): Promise<void> {
    const criteria: (Buffer | string)[] = [];
    ids.forEach((id) =>
      criteria.push(encodeKey(this.bucket, id))
    );
    await this.db.batchDelete(criteria);
  }

  public async deleteManyByValue(values: T[]): Promise<void> {
    await this.deleteMany(values.map(value => hashTreeRoot(value, this.type)));
  }

  public async deleteAll(idFunction?: (value: T) => Id): Promise<void> {
    const data = await this.getAll();
    const defaultIdFunction: (value: T) => Id =
      (value): Id => hashTreeRoot(value, this.type);
    await this.deleteMany(data.map(idFunction || defaultIdFunction));
  }

}
