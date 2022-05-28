/**
 * @module metrics
 */

import {HttpMetricsServerOpts} from "./server/index.js";

export type LodestarMetadata = {
  /** "v0.16.0/developer/feature-1/ac99f2b5" */
  version: string;
  /** "4f816b16dfde718e2d74f95f2c8292596138c248" */
  commit: string;
  /** "prater" */
  network: string;
};

export type MetricsOptions = HttpMetricsServerOpts & {
  enabled: boolean;
  /** Optional metadata to send to Prometheus */
  metadata?: LodestarMetadata;
};

export const defaultMetricsOptions: MetricsOptions = {
  enabled: false,
  port: 8008,
};
