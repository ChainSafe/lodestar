import {ArrayLike} from "@chainsafe/ssz";
import {BulkRepository} from "../../db/api/beacon/repository";

export abstract class OperationsModule<T> {

  protected readonly db: BulkRepository<T>;

  public constructor(db: BulkRepository<T>) {
    this.db = db;
  }

  public async receive(value: T): Promise<void> {
    await this.db.add(value);
  }

  public async getAll(): Promise<T[]> {
    return await this.db.getAll();
  }

  public async remove(values: ArrayLike<T>): Promise<void> {
    await this.db.deleteManyByValue(values);
  }

}

