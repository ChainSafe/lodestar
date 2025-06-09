import fs from "node:fs";
import path from "node:path";
import worker from "node:worker_threads";
import {expose} from "@chainsafe/threads/worker";
import {getNodeLogger} from "@lodestar/logger/node";
import {fulu} from "@lodestar/types";
import {Gauge, Histogram} from "@lodestar/utils";
import {RegistryMetricCreator, collectNodeJSMetrics} from "../../metrics/index.js";
import {recoverDataColumnSidecars} from "../../util/blobs.js";
import {initCKZG, loadEthereumTrustedSetup} from "../../util/kzg.js";
import {profileNodeJS, writeHeapSnapshot} from "../../util/profile.js";
import {DataColumnRecoverWorkerApi, DataColumnWorkerData} from "./types.js";

const workerData = worker.workerData as DataColumnWorkerData;
const {loggerOpts, trustedSetupPrecompute, trustedSetup} = workerData;

const logger = getNodeLogger(loggerOpts);
const abortController = new AbortController();

await initCKZG();
loadEthereumTrustedSetup(trustedSetupPrecompute, trustedSetup);

logger.info("data_column worker thread: loaded c-kzg trusted setup the same to main thread");

// Set up metrics
let metricsRegistry: RegistryMetricCreator | undefined;
let recoverTime: Histogram | undefined;
let recoverFailed: Gauge | undefined;
let partialDataColumnCount: Gauge | undefined;
let closeMetrics: () => void | undefined;
if (workerData.metrics) {
  metricsRegistry = new RegistryMetricCreator();
  closeMetrics = collectNodeJSMetrics(metricsRegistry, "data_column_worker_");
  abortController.signal.addEventListener("abort", closeMetrics, {once: true});
  recoverTime = metricsRegistry.histogram({
    name: "lodestar_data_column_sidecar_recover_time_seconds",
    help: "Time elapsed to recover data column sidecar",
    buckets: [1, 2, 3, 4, 8],
  });
  recoverFailed = metricsRegistry.gauge({
    name: "lodestar_data_column_sidecar_recover_failed_total",
    help: "Total count of failed recoveries of data column sidecars",
  });
  partialDataColumnCount = metricsRegistry.gauge({
    name: "lodestar_data_column_sidecar_recover_partial_data_column_count",
    help: "Total partial data columns per call",
  });
}

const module: DataColumnRecoverWorkerApi = {
  recoverDataColumnSidecars: (
    partialSidecars: Map<number, fulu.DataColumnSidecar>
  ): Promise<fulu.DataColumnSidecars | null> => {
    logger.verbose("data_column_recover worker: recovering data column sidecars", {
      partialSidecars: partialSidecars.size,
    });
    partialDataColumnCount?.set(partialSidecars.size);
    const timer = recoverTime?.startTimer();
    const result = recoverDataColumnSidecars(partialSidecars);
    timer?.();
    if (result == null) {
      logger.debug("data_column_recover worker: failed to recover data column sidecars");
      recoverFailed?.inc();
    } else {
      logger.verbose("data_column_recover worker: recovered data column sidecars", {fullSidecars: result.length});
    }
    return Promise.resolve(result);
  },
  async close() {
    abortController.abort();
  },
  async scrapeMetrics(): Promise<string> {
    return (await metricsRegistry?.metrics()) ?? "";
  },
  writeProfile: async (durationMs: number, dirpath: string) => {
    const profile = await profileNodeJS(durationMs);
    const filePath = path.join(dirpath, `data_column_recover_thread_${new Date().toISOString()}.cpuprofile`);
    fs.writeFileSync(filePath, profile);
    return filePath;
  },
  writeHeapSnapshot: async (prefix: string, dirpath: string) => {
    return writeHeapSnapshot(prefix, dirpath);
  },
};

expose(module);

logger.info("data_column worker started");
