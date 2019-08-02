import {BulkRepository} from "../../db/api/beacon/repository";

export abstract class OperationsModule<T> {

  protected readonly db: BulkRepository<T>;

  public constructor(db: BulkRepository<T>) {
    this.db = db;
  }

  public async receive(value: T): Promise<void> {
    await this.db.setUnderRoot(value);
  }

  public async getAll(): Promise<T[]> {
    return await this.db.getAll();
  }

  public async remove(values: T[]): Promise<void> {
    await this.db.deleteManyByValue(values);
  }

}

