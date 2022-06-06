import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Db} from "./controller/index.js";

export interface IDatabaseApiOptions {
  config: IChainForkConfig;
  controller: Db;
}

export abstract class DatabaseService {
  protected config: IChainForkConfig;
  protected db: Db;

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
