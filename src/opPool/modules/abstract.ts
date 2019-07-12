import {BeaconDB} from "../../db";

export abstract class OperationsModule {

  protected readonly db: BeaconDB;

  public constructor(db: BeaconDB) {
    this.db = db;
  }

}

