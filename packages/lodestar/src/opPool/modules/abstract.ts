import {ArrayLike} from "@chainsafe/ssz";
import {Repository, Id} from "../../db/api/beacon/repositories";

export abstract class OperationsModule<T> {

  protected readonly db: Repository<Id, T>;

  public constructor(db: Repository<Id, T>) {
    this.db = db;
  }

  public async receive(value: T): Promise<void> {
    await this.db.add(value);
  }

  public async getAll(): Promise<T[]> {
    return await this.db.values();
  }

  public async remove(values: ArrayLike<T>): Promise<void> {
    await this.db.batchRemove(values);
  }

}

