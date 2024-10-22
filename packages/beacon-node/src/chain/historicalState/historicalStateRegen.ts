import path from "node:path";
import {ModuleThread, Thread, spawn, Worker} from "@chainsafe/threads";
import {chainConfigToJson} from "@lodestar/config";
import {LoggerNode} from "@lodestar/logger/node";
import {
  HistoricalStateRegenInitModules,
  HistoricalStateRegenModules,
  HistoricalStateWorkerApi,
  HistoricalStateWorkerData,
  IHistoricalStateRegen,
} from "./types.js";
import {HierarchicalLayers} from "./utils/hierarchicalLayers.js";
import {StateArchiveMode} from "../archiver/interface.js";

// Worker constructor consider the path relative to the current working directory
const WORKER_DIR = process.env.NODE_ENV === "test" ? "../../../lib/chain/historicalState" : "./";

/**
 * HistoricalStateRegen use hierarchical binary difference to minimize the effort and storage requirement to regenerate historical state
 * As its compute intensive job, it will use a separate worker thread.
 *
 * @see following [doc](../../../../docs/pages/contribution/advance-topics/historical-state-regen.md) for further details.
 */
export class HistoricalStateRegen implements IHistoricalStateRegen {
  private readonly api: ModuleThread<HistoricalStateWorkerApi>;
  private readonly logger: LoggerNode;
  private readonly stateArchiveMode: StateArchiveMode;

  constructor(modules: HistoricalStateRegenModules) {
    this.api = modules.api;
    this.logger = modules.logger;
    this.stateArchiveMode = modules.stateArchiveMode;
    modules.signal?.addEventListener("abort", () => this.close(), {once: true});
  }
  static async init(modules: HistoricalStateRegenInitModules): Promise<HistoricalStateRegen> {
    const workerData: HistoricalStateWorkerData = {
      chainConfigJson: chainConfigToJson(modules.config),
      genesisValidatorsRoot: modules.config.genesisValidatorsRoot,
      genesisTime: modules.opts.genesisTime,
      maxConcurrency: 1,
      maxLength: 50,
      dbLocation: modules.opts.dbLocation,
      metricsEnabled: Boolean(modules.metrics),
      loggerOpts: modules.logger.toOpts(),
      hierarchicalLayersConfig: modules.hierarchicalLayersConfig ?? HierarchicalLayers.fromString().toString(),
    };

    const worker = new Worker(path.join(WORKER_DIR, "worker.js"), {
      workerData,
    } as ConstructorParameters<typeof Worker>[1]);

    const api = await spawn<HistoricalStateWorkerApi>(worker, {
      // A Lodestar Node may do very expensive task at start blocking the event loop and causing
      // the initialization to timeout. The number below is big enough to almost disable the timeout
      timeout: 5 * 60 * 1000,
    });

    return new HistoricalStateRegen({...modules, api});
  }

  async scrapeMetrics(): Promise<string> {
    return this.api.scrapeMetrics();
  }

  async close(): Promise<void> {
    await this.api.close();
    this.logger.debug("Terminating historical state worker");
    await Thread.terminate(this.api);
    this.logger.debug("Terminated historical state worker");
  }

  async getHistoricalState(slot: number): Promise<Uint8Array | null> {
    return this.api.getHistoricalState(slot, this.stateArchiveMode);
  }

  async storeHistoricalState(slot: number, stateBytes: Uint8Array): Promise<void> {
    return this.api.storeHistoricalState(slot, this.stateArchiveMode, stateBytes);
  }
}
