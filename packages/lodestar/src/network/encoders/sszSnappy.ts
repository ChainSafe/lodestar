import {LodestarError} from "@chainsafe/lodestar-utils";
import BufferList from "bl";
import varint from "varint";
import {MAX_VARINT_BYTES, ReqRespEncoding} from "../../constants";
import {getDecompressor, maxEncodedLen} from "./utils";
import {BufferedSource} from "./bufferedSource";

export interface ISszSizeBounds {
  minSize: number;
  maxSize: number;
}

export async function readSszSnappyChunk(
  bufferedSource: BufferedSource,
  sszSizeBounds: ISszSizeBounds
): Promise<Buffer> {
  const sszDataLength = await readSszSnappyHeader(bufferedSource);
  validateSszSizeBounds(sszDataLength, sszSizeBounds);
  return await readSszSnappyPayload(bufferedSource, sszDataLength);
}

async function readSszSnappyHeader(bufferedSource: BufferedSource): Promise<number> {
  for await (const buffer of bufferedSource) {
    // Get next bytes if empty
    if (buffer.length === 0) {
      continue;
    }

    // encoding-dependent-header for ssz_snappy
    // Header ::= the length of the raw SSZ bytes, encoded as an unsigned protobuf varint
    const sszDataLength = varint.decode(buffer.slice());
    const varintBytes = varint.decode.bytes;
    if (varintBytes > MAX_VARINT_BYTES) {
      throw new SszSnappyError({code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: varintBytes});
    }
    buffer.consume(varintBytes);

    return sszDataLength;
  }

  throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
}

function validateSszSizeBounds(sszDataLength: number, {minSize, maxSize}: ISszSizeBounds): void {
  // MUST validate that the length-prefix is within the expected size bounds derived from the payload SSZ type.
  if (sszDataLength < minSize) {
    throw new SszSnappyError({code: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE, minSize, sszDataLength});
  }
  if (sszDataLength > maxSize) {
    throw new SszSnappyError({code: SszSnappyErrorCode.OVER_SSZ_MAX_SIZE, maxSize, sszDataLength});
  }
}

async function readSszSnappyPayload(bufferedSource: BufferedSource, sszDataLength: number): Promise<Buffer> {
  const decompressor = getDecompressor(ReqRespEncoding.SSZ_SNAPPY);
  const uncompressedData = new BufferList();
  let readBytes = 0;

  for await (const buffer of bufferedSource) {
    // SHOULD NOT read more than max_encoded_len(n) bytes after reading the SSZ length-prefix n from the header
    readBytes += buffer.length;
    if (readBytes > maxEncodedLen(sszDataLength, ReqRespEncoding.SSZ_SNAPPY)) {
      throw new SszSnappyError({code: SszSnappyErrorCode.TOO_MUCH_BYTES_READ, readBytes, sszDataLength});
    }

    // No bytes left to consume, get next
    if (buffer.length === 0) {
      continue;
    }

    let uncompressed: Buffer | null = null;
    try {
      uncompressed = decompressor.uncompress(buffer.slice());
      buffer.consume(buffer.length);
    } catch (e) {
      throw new SszSnappyError({code: SszSnappyErrorCode.DECOMPRESSOR_ERROR, decompressorError: e});
    }

    if (uncompressed === null) {
      continue;
    }

    uncompressedData.append(uncompressed);

    // SHOULD consider invalid reading more bytes than `n` SSZ bytes
    if (uncompressedData.length > sszDataLength) {
      throw new SszSnappyError({code: SszSnappyErrorCode.TOO_MANY_BYTES, sszDataLength});
    }

    // Keep reading chunks until `n` SSZ bytes
    if (uncompressedData.length < sszDataLength) {
      continue;
    }

    // buffer.length === n

    return uncompressedData.slice(0, sszDataLength);
  }

  throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
}

export enum SszSnappyErrorCode {
  /** Invalid number of bytes for protobuf varint */
  INVALID_VARINT_BYTES_COUNT = "SSZ_SNAPPY_ERROR_INVALID_VARINT_BYTES_COUNT",
  /** Parsed sszDataLength is under the SSZ type min size */
  UNDER_SSZ_MIN_SIZE = "SSZ_SNAPPY_ERROR_UNDER_SSZ_MIN_SIZE",
  /** Parsed sszDataLength is over the SSZ type max size */
  OVER_SSZ_MAX_SIZE = "SSZ_SNAPPY_ERROR_OVER_SSZ_MAX_SIZE",
  TOO_MUCH_BYTES_READ = "SSZ_SNAPPY_ERROR_TOO_MUCH_BYTES_READ",
  DECOMPRESSOR_ERROR = "SSZ_SNAPPY_ERROR_DECOMPRESSOR_ERROR",
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
  | {code: SszSnappyErrorCode.TOO_MANY_BYTES; sszDataLength: number}
  | {code: SszSnappyErrorCode.SOURCE_ABORTED};

export class SszSnappyError extends LodestarError<SszSnappyErrorType> {
  constructor(type: SszSnappyErrorType) {
    super(type);
  }
}
