import path from "node:path";
import {Worker} from "node:worker_threads";
import {fileURLToPath} from "node:url";
import {chainConfigToJson} from "@lodestar/config";
import {terminateWorkerThread} from "../../../util/workerEvents.js";
import {createWorkerRpcClient} from "../../../util/workerRpc.js";
import {
  HistoricalStateRegenInitModules,
  HistoricalStateRegenModules,
  HistoricalStateWorkerApi,
  HistoricalStateWorkerData,
} from "./types.js";

// Resolve worker path relative to this file
// In dev/test mode: running from src/, worker is in lib/
// In production: running from lib/, worker is in same directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath =
  process.env.NODE_ENV === "test"
    ? path.join(__dirname, "../../../../lib/chain/archiveStore/historicalState/worker.js")
    : path.join(__dirname, "worker.js");

const HISTORICAL_STATE_WORKER_TIMEOUT_MS = 1000;
const HISTORICAL_STATE_WORKER_TIMEOUT_RETRY_COUNT = 3;

/**
 * HistoricalStateRegen limits the damage from recreating historical states
 * by running regen in a separate worker thread.
 */
export class HistoricalStateRegen implements HistoricalStateWorkerApi {
  private readonly modules: HistoricalStateRegenModules;

  constructor(modules: HistoricalStateRegenModules) {
    this.modules = modules;
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
    };

    const worker = new Worker(workerPath, {workerData});

    // Wait for worker to be online
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Historical state worker initialization timeout"));
      }, 5 * 60 * 1000);

      worker.once("online", () => {
        clearTimeout(timeout);
        resolve();
      });

      worker.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Subscribe to worker errors
    worker.on("error", (err) => {
      modules.logger.error("Historical state worker thread error", {}, err);
    });

    // Create RPC client for typed method calls
    const {api, close: closeRpc} = createWorkerRpcClient<HistoricalStateWorkerApi>(worker);

    return new HistoricalStateRegen({
      ...modules,
      api,
      worker,
      closeRpc,
    });
  }

  async scrapeMetrics(): Promise<string> {
    return this.modules.api.scrapeMetrics();
  }

  async close(): Promise<void> {
    await this.modules.api.close();
    this.modules.closeRpc();
    this.modules.logger.debug("Terminating historical state worker");
    await terminateWorkerThread({
      worker: this.modules.worker,
      retryCount: HISTORICAL_STATE_WORKER_TIMEOUT_RETRY_COUNT,
      retryMs: HISTORICAL_STATE_WORKER_TIMEOUT_MS,
    });
    this.modules.logger.debug("Terminated historical state worker");
  }

  async getHistoricalState(slot: number): Promise<Uint8Array> {
    return this.modules.api.getHistoricalState(slot);
  }
}
