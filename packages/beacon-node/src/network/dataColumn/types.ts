import {ModuleThread} from "@chainsafe/threads";
import {LoggerNode, LoggerNodeOpts} from "@lodestar/logger/node";
import {fulu} from "@lodestar/types";
import {Metrics} from "../../metrics/index.js";

export type DataColumnRecoverInitModules = {
  logger: LoggerNode;
  metrics: Metrics | null;
  /*
   * This is the window size for the windowed multiplication in proof
   * generation. The larger wbits is, the faster the MSM will be, but the
   * size of the precomputed table will grow exponentially. With 8 bits, the
   * tables are 96 MiB; with 9 bits, the tables are 192 MiB and so forth.
   * From our testing, there are diminishing returns after 8 bits.
   */
  trustedSetupPrecompute?: number;
  /** Option to load a custom kzg trusted setup in txt format */
  trustedSetup?: string;
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
  /*
   * This is the window size for the windowed multiplication in proof
   * generation. The larger wbits is, the faster the MSM will be, but the
   * size of the precomputed table will grow exponentially. With 8 bits, the
   * tables are 96 MiB; with 9 bits, the tables are 192 MiB and so forth.
   * From our testing, there are diminishing returns after 8 bits.
   */
  trustedSetupPrecompute?: number;
  /** Option to load a custom kzg trusted setup in txt format */
  trustedSetup?: string;
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
