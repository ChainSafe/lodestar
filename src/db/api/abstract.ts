import {IDatabaseController} from "../controller";
import {BeaconConfig} from "../../config";
import {Service} from "../../node";

export interface DatabaseApiOptions {
  config: BeaconConfig;
  controller: IDatabaseController;
}

export abstract class DatabaseService implements Service{

  protected config: BeaconConfig;
  protected db: IDatabaseController;

  protected constructor(opts: DatabaseApiOptions) {
    this.config = opts.config;
    this.db = opts.controller;
  }

  public async start(): Promise<void> {
    await this.db.start();
  }

  public async stop(): Promise<void> {
    await this.db.stop();
  }

}
