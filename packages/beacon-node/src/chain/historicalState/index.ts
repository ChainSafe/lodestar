import {ModuleThread, spawn} from "@chainsafe/threads";
import {chainConfigToJson} from "@lodestar/config";
import {LoggerNode} from "@lodestar/logger/node";
import {terminateWorkerThread} from "../../util/workerEvents.js";
import {
  HistoricalStateRegenInitModules,
  HistoricalStateRegenModules,
  HistoricalStateWorkerApi,
  HistoricalStateWorkerData,
} from "./types.js";

const HISTORICAL_STATE_WORKER_EXIT_RETRY_COUNT = 3;
const HISTORICAL_STATE_WORKER_EXIT_TIMEOUT_MS = 1000;

/**
 * HistoricalStateRegen limits the damage from recreating historical states
 * by running regen in a separate worker thread.
 */
export class HistoricalStateRegen implements HistoricalStateWorkerApi {
  private readonly api: ModuleThread<HistoricalStateWorkerApi>;
  private readonly logger: LoggerNode;

  constructor(modules: HistoricalStateRegenModules) {
    this.api = modules.api;
    this.logger = modules.logger;
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
    };

    const worker = new Worker("./worker.js", {
      workerData,
    } as ConstructorParameters<typeof Worker>[1]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    await terminateWorkerThread({
      worker: this.api,
      retryCount: HISTORICAL_STATE_WORKER_EXIT_RETRY_COUNT,
      retryMs: HISTORICAL_STATE_WORKER_EXIT_TIMEOUT_MS,
      logger: this.logger,
    });
    this.logger.debug("Terminated historical state worker");
  }

  async getHistoricalState(slot: number): Promise<Uint8Array> {
    return this.api.getHistoricalState(slot);
  }
}
