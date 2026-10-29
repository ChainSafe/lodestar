import {LodestarError} from "@lodestar/utils";

export enum DataColumnStoreErrorCode {
  INVALID_ROOT = "DATA_COLUMN_STORE_INVALID_ROOT",
  INVALID_SLOT = "DATA_COLUMN_STORE_INVALID_SLOT",
  SLOT_OUT_OF_RANGE = "DATA_COLUMN_STORE_SLOT_OUT_OF_RANGE",
  INVALID_BITMAP_LENGTH = "DATA_COLUMN_STORE_INVALID_BITMAP_LENGTH",
  INVALID_BLOCK_ROOT_LENGTH = "DATA_COLUMN_STORE_INVALID_BLOCK_ROOT_LENGTH",
  FILE_TOO_SMALL = "DATA_COLUMN_STORE_FILE_TOO_SMALL",
  UNSUPPORTED_VERSION = "DATA_COLUMN_STORE_UNSUPPORTED_VERSION",
  EMPTY_COLUMNS = "DATA_COLUMN_STORE_EMPTY_COLUMNS",
  INVALID_COLUMN_INDEX = "DATA_COLUMN_STORE_INVALID_COLUMN_INDEX",
  DUPLICATE_COLUMN_INDEX = "DATA_COLUMN_STORE_DUPLICATE_COLUMN_INDEX",
  INVALID_OFFSET_TABLE = "DATA_COLUMN_STORE_INVALID_OFFSET_TABLE",
  SLOT_PRUNED = "DATA_COLUMN_STORE_SLOT_PRUNED",
  SLOT_MISMATCH = "DATA_COLUMN_STORE_SLOT_MISMATCH",
  ROOT_MISMATCH = "DATA_COLUMN_STORE_ROOT_MISMATCH",
  UNEXPECTED_EOF = "DATA_COLUMN_STORE_UNEXPECTED_EOF",
  OPERATION_FAILED = "DATA_COLUMN_STORE_OPERATION_FAILED",
  BATCH_DELETE_FAILED = "DATA_COLUMN_STORE_BATCH_DELETE_FAILED",
  STARTUP_FAILED = "DATA_COLUMN_STORE_STARTUP_FAILED",
}

export type DataColumnStoreErrorType =
  | {code: DataColumnStoreErrorCode.INVALID_ROOT; root: string}
  | {code: DataColumnStoreErrorCode.INVALID_SLOT; slot: number}
  | {code: DataColumnStoreErrorCode.SLOT_OUT_OF_RANGE}
  | {code: DataColumnStoreErrorCode.INVALID_BITMAP_LENGTH; length: number}
  | {code: DataColumnStoreErrorCode.INVALID_BLOCK_ROOT_LENGTH; length: number}
  | {code: DataColumnStoreErrorCode.FILE_TOO_SMALL; actual: number; minimum: number}
  | {code: DataColumnStoreErrorCode.UNSUPPORTED_VERSION; version: number}
  | {code: DataColumnStoreErrorCode.EMPTY_COLUMNS}
  | {code: DataColumnStoreErrorCode.INVALID_COLUMN_INDEX; index: number}
  | {code: DataColumnStoreErrorCode.DUPLICATE_COLUMN_INDEX; index: number}
  | {code: DataColumnStoreErrorCode.INVALID_OFFSET_TABLE; reason: string}
  | {code: DataColumnStoreErrorCode.SLOT_PRUNED; slot: number; minRetainedSlot: number}
  | {code: DataColumnStoreErrorCode.SLOT_MISMATCH; headerSlot: number; pathSlot: number}
  | {code: DataColumnStoreErrorCode.ROOT_MISMATCH; headerRoot: string; pathRoot: string}
  | {code: DataColumnStoreErrorCode.UNEXPECTED_EOF; offset: number}
  | {code: DataColumnStoreErrorCode.OPERATION_FAILED; operation: string}
  | {code: DataColumnStoreErrorCode.BATCH_DELETE_FAILED; failures: number}
  | {code: DataColumnStoreErrorCode.STARTUP_FAILED};

export class DataColumnStoreError extends LodestarError<DataColumnStoreErrorType> {
  constructor(type: DataColumnStoreErrorType, message?: string, cause?: unknown) {
    super(type, message);
    this.cause = cause;
  }
}

export function isFsNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
