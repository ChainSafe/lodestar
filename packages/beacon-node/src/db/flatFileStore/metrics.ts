import type {Counter, Histogram} from "@lodestar/utils";
import {DataColumnStoreError, DataColumnStoreErrorCode} from "./errors.js";

export const FlatFileStoreOperation = {
  read: "read",
  write: "write",
  delete: "delete",
  prune: "prune",
} as const;

export type FlatFileStoreOperation = (typeof FlatFileStoreOperation)[keyof typeof FlatFileStoreOperation];

type OperationLabels = {operation: FlatFileStoreOperation};

export type FlatFileStoreMetrics = {
  operationDuration: Histogram<OperationLabels>;
  operationErrors: Counter<OperationLabels>;
  readBytes: Counter;
  writeBytes: Counter;
  prunedDirectories: Counter;
  startupDuration: Histogram;
  startupErrors: Counter;
};

export async function observeFlatFileStoreOperation<T>(
  metrics: FlatFileStoreMetrics | null,
  operation: FlatFileStoreOperation,
  fn: () => Promise<T>
): Promise<T> {
  const labels = {operation};
  const endTimer = metrics?.operationDuration.startTimer(labels);
  try {
    return await fn();
  } catch (e) {
    metrics?.operationErrors.inc(labels);
    if (e instanceof DataColumnStoreError) {
      throw e;
    }
    throw new DataColumnStoreError(
      {code: DataColumnStoreErrorCode.OPERATION_FAILED, operation},
      `Flat file store ${operation} operation failed`,
      e
    );
  } finally {
    endTimer?.();
  }
}
