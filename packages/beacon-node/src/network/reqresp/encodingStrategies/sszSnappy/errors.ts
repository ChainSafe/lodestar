import {LodestarError} from "@lodestar/utils";

export enum SszSnappyErrorCode {
  /** Invalid number of bytes for protobuf varint */
  INVALID_VARINT_BYTES_COUNT = "SSZ_SNAPPY_ERROR_INVALID_VARINT_BYTES_COUNT",
  /** Parsed sszDataLength is under the SSZ type min size */
  UNDER_SSZ_MIN_SIZE = "SSZ_SNAPPY_ERROR_UNDER_SSZ_MIN_SIZE",
  /** Parsed sszDataLength is over the SSZ type max size */
  OVER_SSZ_MAX_SIZE = "SSZ_SNAPPY_ERROR_OVER_SSZ_MAX_SIZE",
  TOO_MUCH_BYTES_READ = "SSZ_SNAPPY_ERROR_TOO_MUCH_BYTES_READ",
  DECOMPRESSOR_ERROR = "SSZ_SNAPPY_ERROR_DECOMPRESSOR_ERROR",
  DESERIALIZE_ERROR = "SSZ_SNAPPY_ERROR_DESERIALIZE_ERROR",
  SERIALIZE_ERROR = "SSZ_SNAPPY_ERROR_SERIALIZE_ERROR",
  /** Received more bytes than specified sszDataLength */
  TOO_MANY_BYTES = "SSZ_SNAPPY_ERROR_TOO_MANY_BYTES",
  /** Source aborted before reading sszDataLength bytes */
  SOURCE_ABORTED = "SSZ_SNAPPY_ERROR_SOURCE_ABORTED",
}

type SszSnappyErrorType =
  | {code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT; bytes: number}
  | {code: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE; minSize: number; sszDataLength: number}
  | {code: SszSnappyErrorCode.OVER_SSZ_MAX_SIZE; maxSize: number; sszDataLength: number}
  | {code: SszSnappyErrorCode.TOO_MUCH_BYTES_READ; readBytes: number; sszDataLength: number}
  | {code: SszSnappyErrorCode.DECOMPRESSOR_ERROR; decompressorError: Error}
  | {code: SszSnappyErrorCode.DESERIALIZE_ERROR; deserializeError: Error}
  | {code: SszSnappyErrorCode.SERIALIZE_ERROR; serializeError: Error}
  | {code: SszSnappyErrorCode.TOO_MANY_BYTES; sszDataLength: number}
  | {code: SszSnappyErrorCode.SOURCE_ABORTED};

export class SszSnappyError extends LodestarError<SszSnappyErrorType> {
  constructor(type: SszSnappyErrorType) {
    super(type);
  }
}
