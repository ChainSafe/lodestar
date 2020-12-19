import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {P2pErrorMessage, ResponseBody} from "@chainsafe/lodestar-types";
import {ILogger, LodestarError} from "@chainsafe/lodestar-utils";
import {CompositeType} from "@chainsafe/ssz";
import {AbortController} from "abort-controller";
import BufferList from "bl";
import varint from "varint";
import {
  MAX_VARINT_BYTES,
  Method,
  MethodResponseType,
  Methods,
  ReqRespEncoding,
  RequestId,
  RpcResponseStatus,
} from "../../constants";
import {IResponseChunk} from "./interface";
import {decodeP2pErrorMessage} from "./errorMessage";
import {encodeResponseStatus, getCompressor, getDecompressor, maxEncodedLen} from "./utils";
import {SszSnappyRequestDecoder} from "./request";

// request         ::= <encoding-dependent-header> | <encoded-payload>
// response        ::= <response_chunk>*
// response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
// result          ::= “0” | “1” | “2” | [“128” ... ”255”]

// `response` has zero or more chunks for SSZ-list responses or exactly one chunk for non-list

export function eth2ResponseEncode(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<IResponseChunk>) => AsyncIterable<Buffer> {
  return async function* (source) {
    const type = Methods[method].responseSSZType(config);
    let compressor = getCompressor(encoding);
    if (!type) {
      return;
    }

    // Must yield status and length separate so recipient knows how much frames
    // it needs to decompress. With compression we are sending compressed data
    // frame by frame
    for await (const chunk of source) {
      if (chunk.status !== RpcResponseStatus.SUCCESS) {
        yield encodeResponseStatus(chunk.status);
        if (chunk.body) {
          yield Buffer.from(config.types.P2pErrorMessage.serialize(chunk.body as P2pErrorMessage));
        }
        break;
      }

      // yield status
      yield encodeResponseStatus(chunk.status);
      let serializedData: Buffer;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serialized = type.serialize(chunk.body as any);
        serializedData = Buffer.from(serialized.buffer, serialized.byteOffset, serialized.length);
      } catch (e) {
        logger.warn("Failed to ssz serialize chunk", {method}, e);
      }

      // yield encoded ssz length
      yield Buffer.from(varint.encode(serializedData!.length));

      // yield compressed or uncompressed data chunks
      yield* compressor(serializedData!);

      // reset compressor
      compressor = getCompressor(encoding);
    }
  };
}

export function eth2ResponseDecode(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding,
  requestId: RequestId,
  controller: AbortController
): (source: AsyncIterable<Buffer>) => AsyncGenerator<ResponseBody> {
  return async function* (source) {
    // floating buffer with current chunk
    let buffer = new BufferList();

    // holds uncompressed chunks
    let uncompressedData = new BufferList();
    let status: number | null = null;
    let errorMessage: string | null = null;
    let sszLength: number | null = null;

    const decompressor = getDecompressor(encoding);
    const type = Methods[method].responseSSZType(config);

    for await (const chunk of source) {
      buffer.append(chunk);
      if (status === null) {
        status = buffer.get(0);
        buffer.consume(1);
      }

      if (buffer.length === 0) continue;
      if (status && status !== RpcResponseStatus.SUCCESS) {
        try {
          errorMessage = decodeP2pErrorMessage(buffer.slice());
          buffer = new BufferList();
        } catch (e) {
          logger.warn("Failed to get error message from response", {method, requestId}, e);
        }
        logger.warn("eth2ResponseDecode: Received err status", {status, errorMessage, method, requestId});
        controller.abort();
        continue;
      }

      if (sszLength === null) {
        sszLength = varint.decode(buffer.slice());
        const decodedBytes = varint.decode.bytes;
        if (decodedBytes > 10) {
          throw new Error(
            `eth2ResponseDecode: Invalid number of bytes for protobuf varint ${decodedBytes}` + `, method ${method}`
          );
        }
        buffer.consume(decodedBytes);
      }

      if (sszLength < type.minSize() || sszLength > type.maxSize()) {
        throw new Error(`eth2ResponseDecode: Invalid szzLength of ${sszLength} for method ${method}`);
      }

      if (buffer.length > maxEncodedLen(sszLength, encoding)) {
        throw new Error(
          `eth2ResponseDecode: too much bytes read (${buffer.length}) for method ${method}, ` + `sszLength ${sszLength}`
        );
      }

      if (buffer.length === 0) continue;
      let uncompressed: Buffer | null = null;
      try {
        uncompressed = decompressor.uncompress(buffer.slice());
        buffer.consume(buffer.length);
      } catch (e) {
        logger.warn("Failed to uncompress data", {method, requestId, encoding}, e);
      }

      if (uncompressed) {
        uncompressedData.append(uncompressed);
        if (uncompressedData.length > sszLength) {
          throw new Error(`Received too much data for method ${method}`);
        }

        if (uncompressedData.length === sszLength) {
          try {
            if (method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot) {
              yield (((type as unknown) as CompositeType<Record<string, unknown>>).tree.deserialize(
                uncompressedData.slice()
              ) as unknown) as ResponseBody;
            } else {
              yield type.deserialize(uncompressedData.slice()) as ResponseBody;
            }
            buffer = new BufferList();
            uncompressedData = new BufferList();
            decompressor.reset();
            status = null;
            sszLength = null;
            if (Methods[method].responseType === MethodResponseType.SingleResponse) {
              controller.abort();
              continue;
            }
          } catch (e) {
            logger.warn("Failed to ssz deserialize data", {method, requestId, encoding}, e);
          }
        }
      }
    }
    if (buffer.length > 0) {
      throw new Error(`There is remaining data not deserialized for method ${method}`);
    }
  };
}

export function eth2ResponseDecode2(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding,
  requestId: RequestId,
  controller: AbortController
): (source: AsyncIterable<Buffer>) => AsyncGenerator<ResponseBody> {
  return async function* (source) {
    const type = Methods[method].responseSSZType(config);

    try {
      const responses = await receiveAndDecodeResponse(source, encoding, type, method);
      for (const response of responses) {
        yield response;
      }
    } catch (e) {
      // # TODO: Append method and requestId to error here
      logger.warn("eth2ResponseDecode", {method, requestId}, e);
    } finally {
      controller.abort();
    }
  };
}

// A requester SHOULD read from the stream until either:
// 1. An error result is received in one of the chunks (the error payload MAY be read before stopping).
// 2. The responder closes the stream.
// 3. Any part of the response_chunk fails validation.
// 4. The maximum number of requested chunks are read.

async function receiveAndDecodeResponse(
  source: AsyncIterable<Buffer>,
  encoding: ReqRespEncoding,
  type: Exclude<ReturnType<typeof Methods[Method]["responseSSZType"]>, null>,
  method: Method
): Promise<ResponseBody[]> {
  // floating buffer with current chunk
  let buffer = new BufferList();

  // holds uncompressed chunks
  let uncompressedData = new BufferList();
  let status: number | null = null;
  let errorMessage: string | null = null;
  let sszDataLength: number | null = null;
  const responses: ResponseBody[] = [];

  const decompressor = getDecompressor(encoding);

  const minSize = type.minSize();
  const maxSize = type.maxSize();

  // response        ::= <response_chunk>*
  // response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
  // result          ::= “0” | “1” | “2” | [“128” ... ”255”]

  for await (const chunk of source) {
    buffer.append(chunk);

    if (status === null) {
      status = buffer.get(0);
      buffer.consume(1);

      // If first chunk had zero bytes status === null, get next
      if (status === null) {
        continue;
      }
    }

    // No bytes left to consume, get next with either ErrorMessage or EncodingHeader
    if (buffer.length === 0) {
      continue;
    }

    // For multiple chunks, only the last chunk is allowed to have a non-zero error
    // code (i.e. The chunk stream is terminated once an error occurs
    if (status !== RpcResponseStatus.SUCCESS) {
      try {
        errorMessage = decodeP2pErrorMessage(buffer.slice());
        buffer = new BufferList();
      } catch (e) {
        throw new ResponseDecodeError({code: ResponseDecodeErrorCode.FAILED_DECODE_ERROR, status, error: e});
      }
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.RECEIVED_ERROR_STATUS, status, errorMessage});
    }

    // encoding-dependent-header for ssz_snappy
    // Header ::= the length of the raw SSZ bytes, encoded as an unsigned protobuf varint
    if (sszDataLength === null) {
      sszDataLength = varint.decode(buffer.slice());
      const varintBytes = varint.decode.bytes;
      if (varintBytes > MAX_VARINT_BYTES) {
        throw new ResponseDecodeError({code: ResponseDecodeErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: varintBytes});
      }
      buffer.consume(varintBytes);
    }

    // MUST validate that the length-prefix is within the expected size bounds derived from the payload SSZ type.
    if (sszDataLength < minSize) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.UNDER_SSZ_MIN_SIZE, minSize, sszDataLength});
    }
    if (sszDataLength > maxSize) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.OVER_SSZ_MAX_SIZE, maxSize, sszDataLength});
    }

    // SHOULD NOT read more than max_encoded_len(n) bytes after reading the SSZ length-prefix n from the header
    const chunkLength = chunk.length;
    if (chunkLength > maxEncodedLen(sszDataLength, encoding)) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.TOO_MUCH_BYTES_READ, chunkLength, sszDataLength});
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
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.DECOMPRESSOR_ERROR, decompressorError: e});
    }

    if (uncompressed === null) {
      continue;
    }

    uncompressedData.append(uncompressed);

    // SHOULD consider invalid reading more bytes than `n` SSZ bytes
    if (uncompressedData.length > sszDataLength) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.TOO_MANY_BYTES, sszDataLength});
    }

    // Keep reading chunks until `n` SSZ bytes
    if (uncompressedData.length < sszDataLength) {
      continue;
    }

    let body: ResponseBody;
    try {
      body = deserializeResponseBody(method, type, uncompressedData.slice());
    } catch (e) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.SSZ_DESERIALIZE_ERROR, sszError: e});
      // No throw
    }

    responses.push(body);

    if (Methods[method].responseType === MethodResponseType.SingleResponse) {
      break;
      // controller.abort();
      // continue;
    } else {
      // Q: what's the point to reuse buffer and every variable except for decompressor
      //    instead of just declare them inside the for loop?
      // A: I could call consume on buffer and uncompressData to remove all buffers
      //    but I feel like this is faster as it will leave current data for gc to
      //    clean while consume might be fiddling with existing arrays. Decompressor
      //    has reset method to this cleanup. Once we deserialize data it means we
      //    reached end of chunk, and next one will be exactly the same so we just reset
      //    everything. I should add more code comments here
      buffer = new BufferList();
      uncompressedData = new BufferList();
      decompressor.reset();
      status = null;
      sszDataLength = null;
    }
  }

  if (buffer.length > 0) {
    throw new Error(`There is remaining data not deserialized for method ${method}`);
  }

  return responses;
}

async function receiveAndDecodeResponseWithFn(
  source: AsyncIterable<Buffer>,
  encoding: ReqRespEncoding,
  type: Exclude<ReturnType<typeof Methods[Method]["responseSSZType"]>, null>,
  method: Method
): Promise<ResponseBody[]> {
  // floating buffer with current chunk
  let buffer = new BufferList();

  // holds uncompressed chunks
  let uncompressedData = new BufferList();
  let status: number | null = null;
  let errorMessage: string | null = null;
  let sszDataLength: number | null = null;
  const responses: ResponseBody[] = [];

  const decompressor = getDecompressor(encoding);

  // response        ::= <response_chunk>*
  // response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
  // result          ::= “0” | “1” | “2” | [“128” ... ”255”]

  const sszSnappyRequestDecoder = SszSnappyRequestDecoder(encoding, type);

  for await (const chunk of source) {
    buffer.append(chunk);

    if (status === null) {
      status = buffer.get(0);
      buffer.consume(1);

      // If first chunk had zero bytes status === null, get next
      if (status === null) {
        continue;
      }
    }

    // No bytes left to consume, get next with either ErrorMessage or EncodingHeader
    if (buffer.length === 0) {
      continue;
    }

    // For multiple chunks, only the last chunk is allowed to have a non-zero error
    // code (i.e. The chunk stream is terminated once an error occurs
    if (status !== RpcResponseStatus.SUCCESS) {
      try {
        errorMessage = decodeP2pErrorMessage(buffer.slice());
        buffer = new BufferList();
      } catch (e) {
        throw new ResponseDecodeError({code: ResponseDecodeErrorCode.FAILED_DECODE_ERROR, status, error: e});
      }
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.RECEIVED_ERROR_STATUS, status, errorMessage});
    }

    const decodeRes = sszSnappyRequestDecoder(chunk);
    if (decodeRes.status === "NEXT") {
      continue;
    } else {
      yield decodeRes.body;
    }

    let body: ResponseBody;
    try {
      body = deserializeResponseBody(method, type, uncompressedData.slice());
    } catch (e) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.SSZ_DESERIALIZE_ERROR, sszError: e});
      // No throw
    }

    responses.push(body);

    if (Methods[method].responseType === MethodResponseType.SingleResponse) {
      break;
      // controller.abort();
      // continue;
    } else {
      // Q: what's the point to reuse buffer and every variable except for decompressor
      //    instead of just declare them inside the for loop?
      // A: I could call consume on buffer and uncompressData to remove all buffers
      //    but I feel like this is faster as it will leave current data for gc to
      //    clean while consume might be fiddling with existing arrays. Decompressor
      //    has reset method to this cleanup. Once we deserialize data it means we
      //    reached end of chunk, and next one will be exactly the same so we just reset
      //    everything. I should add more code comments here
      buffer = new BufferList();
      uncompressedData = new BufferList();
      decompressor.reset();
      status = null;
      sszDataLength = null;
    }
  }

  if (buffer.length > 0) {
    throw new Error(`There is remaining data not deserialized for method ${method}`);
  }

  return responses;
}

async function receiveAndDecodeResponse2(source: AsyncIterable<Buffer>) {
  const bufferedSource = new BufferedSource(source);

  for (let i = 0; i < maxItems; i++) {
    await readResultHeader(bufferedSource);
    const sszDataLength = await readSszSnappyHeader(bufferedSource);
    const uncompressed = await decompressBytes(bufferedSource, sszDataLength);
  }
}

async function readResultHeader(bufferedSource: BufferedSource) {
  for await (const _ of bufferedSource) {
    const status = bufferedSource.buffer.get(0);
    bufferedSource.buffer.consume(1);

    // If first chunk had zero bytes status === null, get next
    if (status === null) {
      continue;
    }

    // For multiple chunks, only the last chunk is allowed to have a non-zero error
    // code (i.e. The chunk stream is terminated once an error occurs
    if (status === RpcResponseStatus.SUCCESS) {
      return;
    }

    // No bytes left to consume, get next bytes for ErrorMessage
    if (bufferedSource.buffer.length === 0) {
      continue;
    }

    try {
      const errorMessage = decodeP2pErrorMessage(buffer.slice());
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.RECEIVED_ERROR_STATUS, status, errorMessage});
    } catch (e) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.FAILED_DECODE_ERROR, status, error: e});
    }
  }
}

async function readSszSnappyHeader(bufferedSource: BufferedSource) {
  for await (const _ of bufferedSource) {
    // Get next bytes if empty
    if (bufferedSource.buffer.length === 0) {
      continue;
    }

    // encoding-dependent-header for ssz_snappy
    // Header ::= the length of the raw SSZ bytes, encoded as an unsigned protobuf varint
    const sszDataLength = varint.decode(bufferedSource.buffer.slice());
    const varintBytes = varint.decode.bytes;
    if (varintBytes > MAX_VARINT_BYTES) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: varintBytes});
    }
    bufferedSource.buffer.consume(varintBytes);

    // MUST validate that the length-prefix is within the expected size bounds derived from the payload SSZ type.
    if (sszDataLength < minSize) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.UNDER_SSZ_MIN_SIZE, minSize, sszDataLength});
    }
    if (sszDataLength > maxSize) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.OVER_SSZ_MAX_SIZE, maxSize, sszDataLength});
    }

    return sszDataLength;
  }
}

class BufferedSource {
  buffer: BufferList;
  private source: AsyncGenerator<Buffer>;

  constructor(source: AsyncGenerator<Buffer>) {
    this.buffer = new BufferList();
    this.source = source;
  }

  async next(): Promise<Buffer> {
    const {done, value: chunk} = await this.source.next();
    if (done) {
      throw Error("DONE");
    } else {
      this.buffer.append(chunk);
    }
  }
}

function deserializeResponseBody(
  method: Method,
  type: Exclude<ReturnType<typeof Methods[Method]["responseSSZType"]>, null>,
  bytes: Buffer
): ResponseBody {
  if (method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot) {
    return (((type as unknown) as CompositeType<Record<string, unknown>>).tree.deserialize(
      bytes
    ) as unknown) as ResponseBody;
  } else {
    return type.deserialize(bytes);
  }
}

export enum ResponseDecodeErrorCode {
  /** Response had no status SUCCESS and error message was successfully decoded */
  FAILED_DECODE_ERROR = "RESPONSE_DECODE_ERROR_FAILED_DECODE_ERROR",
  /** Response had no status SUCCESS and error message was successfully decoded */
  RECEIVED_ERROR_STATUS = "RESPONSE_DECODE_ERROR_RECEIVED_STATUS",

  // Old

  /** Invalid number of bytes for protobuf varint */
  INVALID_VARINT_BYTES_COUNT = "RESPONSE_DECODE_ERROR_INVALID_VARINT_BYTES_COUNT",
  /** Parsed sszDataLength is under the SSZ type min size */
  UNDER_SSZ_MIN_SIZE = "RESPONSE_DECODE_ERROR_UNDER_SSZ_MIN_SIZE",
  /** Parsed sszDataLength is over the SSZ type max size */
  OVER_SSZ_MAX_SIZE = "RESPONSE_DECODE_ERROR_OVER_SSZ_MAX_SIZE",
  TOO_MUCH_BYTES_READ = "RESPONSE_DECODE_ERROR_TOO_MUCH_BYTES_READ",
  DECOMPRESSOR_ERROR = "RESPONSE_DECODE_ERROR_DECOMPRESSOR_ERROR",
  /** Received more bytes than specified sszDataLength */
  TOO_MANY_BYTES = "RESPONSE_DECODE_ERROR_TOO_MANY_BYTES",
  SSZ_DESERIALIZE_ERROR = "RESPONSE_DECODE_ERROR_SSZ_DESERIALIZE_ERROR",
  /** Source aborted before reading sszDataLength bytes */
  SOURCE_ABORTED = "RESPONSE_DECODE_ERROR_SOURCE_ABORTED",
}

type ResponseDecodeErrorType =
  | {code: ResponseDecodeErrorCode.FAILED_DECODE_ERROR; status: number; error: Error}
  | {code: ResponseDecodeErrorCode.RECEIVED_ERROR_STATUS; status: number; errorMessage: string}

  // Old
  | {code: ResponseDecodeErrorCode.INVALID_VARINT_BYTES_COUNT; bytes: number}
  | {code: ResponseDecodeErrorCode.UNDER_SSZ_MIN_SIZE; minSize: number; sszDataLength: number}
  | {code: ResponseDecodeErrorCode.OVER_SSZ_MAX_SIZE; maxSize: number; sszDataLength: number}
  | {code: ResponseDecodeErrorCode.TOO_MUCH_BYTES_READ; chunkLength: number; sszDataLength: number}
  | {code: ResponseDecodeErrorCode.DECOMPRESSOR_ERROR; decompressorError: Error}
  | {code: ResponseDecodeErrorCode.TOO_MANY_BYTES; sszDataLength: number}
  | {code: ResponseDecodeErrorCode.SSZ_DESERIALIZE_ERROR; sszError: Error}
  | {code: ResponseDecodeErrorCode.SOURCE_ABORTED};

export class ResponseDecodeError extends LodestarError<ResponseDecodeErrorType> {
  constructor(type: ResponseDecodeErrorType) {
    super(type);
  }
}
