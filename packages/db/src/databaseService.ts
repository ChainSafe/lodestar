import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController} from "./controller";
import {IDbMetrics} from "./metrics";

export interface IDatabaseApiOptions {
  config: IBeaconConfig;
  controller: IDatabaseController<Buffer, Buffer>;
  metrics?: IDbMetrics;
}

export abstract class DatabaseService {
  protected config: IBeaconConfig;
  protected db: IDatabaseController<Buffer, Buffer>;

  protected constructor(opts: IDatabaseApiOptions) {
    this.config = opts.config;
    this.db = opts.controller;
  }

  async start(): Promise<void> {
    await this.db.start();
  }

  async stop(): Promise<void> {
    await this.db.stop();
  }
}
