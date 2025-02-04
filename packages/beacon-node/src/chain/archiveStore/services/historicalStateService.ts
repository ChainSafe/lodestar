import path from "node:path";
import {Thread, Worker, spawn} from "@chainsafe/threads";
import {chainConfigToJson} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {LodestarService} from "../../../interface.js";
import {
  HistoricalStateServiceApi,
  HistoricalStateServiceData,
  HistoricalStateServiceInitModules,
  HistoricalStateServiceModules,
} from "../interface.js";
import {DifferentialLayers} from "../utils/differentialLayers.js";

// Worker constructor consider the path relative to the current working directory
const WORKER_DIR = process.env.NODE_ENV === "test" ? "../../../lib/chain/archiveStore/services" : "./";

/**
 * HistoricalStateRegen use hierarchical binary difference to minimize the effort and storage requirement to regenerate historical state
 * As its compute intensive job, it will use a separate worker thread.
 *
 * @see following [doc](../../../../docs/pages/contribution/advance-topics/historical-state-regen.md) for further details.
 */
export class HistoricalStateService implements HistoricalStateServiceApi {
  private readonly api: LodestarService<HistoricalStateServiceApi>;
  private readonly logger: Logger;

  constructor(modules: HistoricalStateServiceModules, signal: AbortSignal) {
    this.api = modules.api;
    this.logger = modules.logger;
    signal.addEventListener("abort", () => this.close(), {once: true});
  }

  static async init(
    modules: HistoricalStateServiceInitModules,
    opts: {
      genesisTime: number;
      dbLocation: string;
    },
    signal: AbortSignal
  ): Promise<HistoricalStateService> {
    const workerData: HistoricalStateServiceData = {
      chainConfigJson: chainConfigToJson(modules.config),
      genesisValidatorsRoot: modules.config.genesisValidatorsRoot,
      genesisTime: opts.genesisTime,
      maxConcurrency: 1,
      maxLength: 50,
      dbLocation: opts.dbLocation,
      metricsEnabled: Boolean(modules.metrics),
      loggerOpts: modules.logger.toOpts(),
      diffLayers: modules.diffLayers
        ? modules.diffLayers.getLayersString()
        : new DifferentialLayers().getLayersString(),
    };

    const worker = new Worker(path.join(WORKER_DIR, "historicalStateServiceWorker.js"), {
      workerData,
    } as ConstructorParameters<typeof Worker>[1]);

    const api = (await spawn<HistoricalStateServiceApi>(worker, {
      // A Lodestar Node may do very expensive task at start blocking the event loop and causing
      // the initialization to timeout. The number below is big enough to almost disable the timeout
      timeout: 5 * 60 * 1000,
    })) as LodestarService<HistoricalStateServiceApi>;

    return new HistoricalStateService({...modules, api}, signal);
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
    return this.api.getHistoricalState(slot);
  }

  async storeHistoricalState(slot: number, stateBytes: Uint8Array): Promise<void> {
    return this.api.storeHistoricalState(slot, stateBytes);
  }
}
