import {Counter, Gauge, Histogram} from "@lodestar/utils";

export type LevelDbControllerMetrics = {
  dbReadReq: Counter<{bucket: string}>;
  dbReadItems: Counter<{bucket: string}>;
  dbWriteReq: Counter<{bucket: string}>;
  dbWriteItems: Counter<{bucket: string}>;
  dbSizeTotal: Gauge;
  dbApproximateSizeTime: Histogram;
};
