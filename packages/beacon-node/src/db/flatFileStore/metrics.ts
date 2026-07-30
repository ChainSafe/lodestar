import type {Counter, Gauge, Histogram} from "@lodestar/utils";

export const FlatFileStoreType = {
  blob: "blob",
  column: "column",
} as const;

export type FlatFileStoreType = (typeof FlatFileStoreType)[keyof typeof FlatFileStoreType];

export const FlatFileStoreOperation = {
  read: "read",
  write: "write",
  delete: "delete",
  prune: "prune",
} as const;

export type FlatFileStoreOperation = (typeof FlatFileStoreOperation)[keyof typeof FlatFileStoreOperation];

export const FlatFileStoreMigrationResult = {
  success: "success",
  error: "error",
} as const;

export type FlatFileStoreMigrationResult =
  (typeof FlatFileStoreMigrationResult)[keyof typeof FlatFileStoreMigrationResult];

type StoreLabel = {store: FlatFileStoreType};
type OperationLabels = StoreLabel & {operation: FlatFileStoreOperation};
type MigrationLabels = StoreLabel & {result: FlatFileStoreMigrationResult};

export type FlatFileStoreMetrics = {
  operationDuration: Histogram<OperationLabels>;
  operationErrors: Counter<OperationLabels>;
  readBytes: Counter<StoreLabel>;
  writeBytes: Counter<StoreLabel>;
  files: Gauge<StoreLabel>;
  prunedDirectories: Counter<StoreLabel>;
  startupDuration: Histogram;
  startupErrors: Counter;
  migrationWrites: Counter<MigrationLabels>;
};

export async function observeFlatFileStoreOperation<T>(
  metrics: FlatFileStoreMetrics | null,
  store: FlatFileStoreType,
  operation: FlatFileStoreOperation,
  fn: () => Promise<T>
): Promise<T> {
  const labels = {store, operation};
  const endTimer = metrics?.operationDuration.startTimer(labels);
  try {
    return await fn();
  } catch (e) {
    metrics?.operationErrors.inc(labels);
    throw e;
  } finally {
    endTimer?.();
  }
}
