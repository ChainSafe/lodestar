import {IDatabaseController} from "../controller";
import {Service} from "../../node";

export interface DatabaseApiOptions {
  controller: IDatabaseController;
}

export abstract class DatabaseService implements Service{

  protected db: IDatabaseController;
  protected cache: Record<any, any>;

  protected constructor(opts: DatabaseApiOptions) {
    this.db = opts.controller;
    this.cache = {};
  }

  public async start(): Promise<void> {
    await this.db.start();
  }

  public async stop(): Promise<void> {
    await this.db.stop();
  }

}
