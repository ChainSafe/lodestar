import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {IDatabaseController} from "./controller";
import {IDbMetrics} from "./metrics";

export interface IDatabaseApiOptions {
  config: IChainForkConfig;
  controller: IDatabaseController<Uint8Array, Uint8Array>;
  metrics?: IDbMetrics;
}

export abstract class DatabaseService {
  protected config: IChainForkConfig;
  protected db: IDatabaseController<Uint8Array, Uint8Array>;

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
