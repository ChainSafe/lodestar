import {ModuleThread} from "@chainsafe/threads";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {fulu} from "@lodestar/types";
import {Metrics} from "../../metrics/index.js";

export type DataColumnRecoverInitModules = {
  logger: LoggerNode;
  metrics: Metrics | null;
};

export type DataColumnRecoverModules = DataColumnRecoverInitModules & {
  api: ModuleThread<DataColumnRecoverWorkerApi>;
};

/**
 * data_column worker constructor data
 */
export interface DataColumnWorkerData {
  metrics: boolean;
  loggerOpts: LoggerNodeOpts;
}

/**
 * API exposed by the data_column worker
 */
export type DataColumnRecoverWorkerApi = {
  /** See https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/das-core.md#recover_matrix */
  recoverDataColumnSidecars(
    partialSidecars: Map<number, fulu.DataColumnSidecar>
  ): Promise<fulu.DataColumnSidecars | null>;

  close(): Promise<void>;

  /** Prometheus metrics string */
  scrapeMetrics(): Promise<string>;

  /** write profile to disc */
  writeProfile(durationMs: number, dirpath: string): Promise<string>;
  /** write heap snapshot to disc */
  writeHeapSnapshot(prefix: string, dirpath: string): Promise<string>;
};
