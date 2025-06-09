import path from "node:path";
import {ModuleThread, Thread, Worker, spawn} from "@chainsafe/threads";
import {LoggerNode} from "@lodestar/logger/node";
import {fulu} from "@lodestar/types";
import {
  DataColumnRecoverInitModules,
  DataColumnRecoverModules,
  DataColumnRecoverWorkerApi,
  DataColumnWorkerData,
} from "./types.js";

// Worker constructor consider the path relative to the current working directory
const WORKER_DIR = process.env.NODE_ENV === "test" ? "../../../../lib/network/dataColumn" : "./";

export class DataColumnRecover implements DataColumnRecoverWorkerApi {
  private readonly api: ModuleThread<DataColumnRecoverWorkerApi>;
  private readonly logger: LoggerNode;

  constructor(modules: DataColumnRecoverModules) {
    this.api = modules.api;
    this.logger = modules.logger;
  }

  static async init(modules: DataColumnRecoverInitModules): Promise<DataColumnRecover> {
    const workerData: DataColumnWorkerData = {
      loggerOpts: modules.logger.toOpts(),
      metrics: Boolean(modules.metrics),
    };
    const worker = new Worker(path.join(WORKER_DIR, "worker.js"), {
      workerData,
    } as ConstructorParameters<typeof Worker>[1]);

    const api = await spawn<DataColumnRecoverWorkerApi>(worker, {
      // A Lodestar Node may do very expensive task at start blocking the event loop and causing
      // the initialization to timeout. The number below is big enough to almost disable the timeout
      timeout: 5 * 60 * 1000,
    });

    return new DataColumnRecover({...modules, api});
  }

  async recoverDataColumnSidecars(
    partialSidecars: Map<number, fulu.DataColumnSidecar>
  ): Promise<fulu.DataColumnSidecars | null> {
    this.logger.verbose("Recovering data column sidecars", {partialSidecars: partialSidecars.size});
    const result = await this.api.recoverDataColumnSidecars(partialSidecars);
    if (result == null) {
      this.logger.warn("Failed to recover data column sidecars");
    } else {
      this.logger.verbose("Recovered data column sidecars", {fullSidecars: result.length});
    }
    return result;
  }

  async close(): Promise<void> {
    await this.api.close();
    this.logger.debug("Terminating data column recover worker");
    await Thread.terminate(this.api);
    this.logger.debug("Terminated data column recover worker");
  }

  async scrapeMetrics(): Promise<string> {
    return this.api.scrapeMetrics();
  }

  async writeProfile(durationMs: number, dirpath: string): Promise<string> {
    return this.api.writeProfile(durationMs, dirpath);
  }

  async writeHeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    return this.api.writeHeapSnapshot(prefix, dirpath);
  }
}
