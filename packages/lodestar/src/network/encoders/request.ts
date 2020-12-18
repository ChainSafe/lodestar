import {Method, Methods, ReqRespEncoding} from "../../constants";
import {ILogger, LodestarError} from "@chainsafe/lodestar-utils";
import {RequestBody} from "@chainsafe/lodestar-types";
import {decode, encode} from "varint";
import BufferList from "bl";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getCompressor, getDecompressor, maxEncodedLen} from "./utils";
import {IValidatedRequestBody} from "./interface";

export function eth2RequestEncode(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<RequestBody | null>) => AsyncGenerator<Buffer> {
  return async function* (source) {
    const type = Methods[method].requestSSZType(config);
    let compressor = getCompressor(encoding);

    for await (const request of source) {
      if (!type || request === null) continue;

      let serialized: Uint8Array;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialized = type.serialize(request as any);
      } catch (e) {
        logger.warn("Malformed input. Failed to serialize request", {method}, e);
        continue;
      }

      yield Buffer.from(encode(serialized.length));

      yield* compressor(Buffer.from(serialized.buffer, serialized.byteOffset, serialized.length));

      // reset compressor
      compressor = getCompressor(encoding);
    }
  };
}

export function eth2RequestDecode(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<Buffer | BufferList>) => AsyncGenerator<IValidatedRequestBody> {
  return async function* (source) {
    const type = Methods[method].requestSSZType(config);
    if (!type) {
      // method has no body, emit null to trigger response
      yield {isValid: true, body: null!};
      return;
    }

    try {
      const body = await receiveAndDecodeRequest(source, encoding, type);
      yield {isValid: true, body};
    } catch (e) {
      logger.error("eth2RequestDecode", e);
      yield {isValid: false};
    }
  };
}

/**
 * Buffers request body source in memory
 * - Uncompress with `encoding`
 * - Deserialize with `type`
 * - Validate byte count is correct
 */
async function receiveAndDecodeRequest(
  source: AsyncIterable<Buffer | BufferList>,
  encoding: ReqRespEncoding,
  type: Exclude<ReturnType<typeof Methods[Method]["requestSSZType"]>, null>
): Promise<RequestBody> {
  let sszDataLength: number | null = null;
  const decompressor = getDecompressor(encoding);
  const buffer = new BufferList();

  const minSize = type.minSize();
  const maxSize = type.maxSize();

  for await (let chunk of source) {
    if (!chunk || chunk.length === 0) {
      continue;
    }

    if (sszDataLength === null) {
      sszDataLength = decode(chunk.slice());
      if (decode.bytes > 10) {
        throw new RequestDecodeError({code: RequestDecodeErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: decode.bytes});
        // yield {isValid: false};
        // break;
      }

      chunk = chunk.slice(decode.bytes);
      if (chunk.length === 0) {
        continue;
      }
    }

    if (sszDataLength < minSize) {
      throw new RequestDecodeError({code: RequestDecodeErrorCode.UNDER_SSZ_MIN_SIZE, minSize, sszDataLength});
    }
    if (sszDataLength > maxSize) {
      throw new RequestDecodeError({code: RequestDecodeErrorCode.OVER_SSZ_MAX_SIZE, maxSize, sszDataLength});
    }

    const chunkLength = chunk.length;
    if (chunkLength > maxEncodedLen(sszDataLength, encoding)) {
      throw new RequestDecodeError({code: RequestDecodeErrorCode.TOO_MUCH_BYTES_READ, chunkLength, sszDataLength});
    }

    let uncompressed: Buffer | null = null;
    try {
      uncompressed = decompressor.uncompress(chunk.slice());
    } catch (e) {
      throw new RequestDecodeError({code: RequestDecodeErrorCode.DECOMPRESSOR_ERROR, decompressorError: e});
    }

    if (uncompressed) {
      buffer.append(uncompressed);
    }

    if (buffer.length < sszDataLength) {
      continue;
    }

    if (buffer.length > sszDataLength) {
      throw new RequestDecodeError({code: RequestDecodeErrorCode.TOO_MANY_BYTES, sszDataLength});
    }

    // only one request body accepted

    // buffer.length === sszDataLength
    try {
      return type.deserialize(buffer.slice(0, sszDataLength));
    } catch (e) {
      throw new RequestDecodeError({code: RequestDecodeErrorCode.SSZ_DESERIALIZE_ERROR, sszError: e});
    }
  }

  throw new RequestDecodeError({code: RequestDecodeErrorCode.SOURCE_ABORTED});
}

enum RequestDecodeErrorCode {
  /** Invalid number of bytes for protobuf varint, expects exactly 10 */
  INVALID_VARINT_BYTES_COUNT = "REQUEST_DECODE_ERROR_INVALID_VARINT_BYTES_COUNT",
  /** Parsed sszDataLength is under the SSZ type min size */
  UNDER_SSZ_MIN_SIZE = "REQUEST_DECODE_ERROR_UNDER_SSZ_MIN_SIZE",
  /** Parsed sszDataLength is over the SSZ type max size */
  OVER_SSZ_MAX_SIZE = "REQUEST_DECODE_ERROR_OVER_SSZ_MAX_SIZE",
  TOO_MUCH_BYTES_READ = "REQUEST_DECODE_ERROR_TOO_MUCH_BYTES_READ",
  DECOMPRESSOR_ERROR = "REQUEST_DECODE_ERROR_DECOMPRESSOR_ERROR",
  /** Received more bytes than specified sszDataLength */
  TOO_MANY_BYTES = "REQUEST_DECODE_ERROR_TOO_MANY_BYTES",
  SSZ_DESERIALIZE_ERROR = "REQUEST_DECODE_ERROR_SSZ_DESERIALIZE_ERROR",
  /** Source aborted before reading sszDataLength bytes */
  SOURCE_ABORTED = "REQUEST_DECODE_ERROR_SOURCE_ABORTED",
}

export type RequestDecodeErrorType =
  | {code: RequestDecodeErrorCode.INVALID_VARINT_BYTES_COUNT; bytes: number}
  | {code: RequestDecodeErrorCode.UNDER_SSZ_MIN_SIZE; minSize: number; sszDataLength: number}
  | {code: RequestDecodeErrorCode.OVER_SSZ_MAX_SIZE; maxSize: number; sszDataLength: number}
  | {code: RequestDecodeErrorCode.TOO_MUCH_BYTES_READ; chunkLength: number; sszDataLength: number}
  | {code: RequestDecodeErrorCode.DECOMPRESSOR_ERROR; decompressorError: Error}
  | {code: RequestDecodeErrorCode.TOO_MANY_BYTES; sszDataLength: number}
  | {code: RequestDecodeErrorCode.SSZ_DESERIALIZE_ERROR; sszError: Error}
  | {code: RequestDecodeErrorCode.SOURCE_ABORTED};

export class RequestDecodeError extends LodestarError<RequestDecodeErrorType> {
  constructor(type: RequestDecodeErrorType) {
    super(type);
  }
}
