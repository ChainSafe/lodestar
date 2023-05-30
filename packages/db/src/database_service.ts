import {ChainForkConfig} from "@lodestar/config";
import {LevelDbControllerMetrics} from "./controller/metrics.js";
import {Db} from "./controller/index.js";

export type DatabaseApiOptions = {
  config: ChainForkConfig;
  controller: Db;
};

export abstract class DatabaseService {
  protected config: ChainForkConfig;
  protected db: Db;

  protected constructor(opts: DatabaseApiOptions) {
    this.config = opts.config;
    this.db = opts.controller;
  }

  async start(): Promise<void> {
    await this.db.start();
  }

  async stop(): Promise<void> {
    await this.db.stop();
  }

  /** To inject metrics after CLI initialization */
  setMetrics(metrics: LevelDbControllerMetrics): void {
    this.db.setMetrics(metrics);
  }
}
