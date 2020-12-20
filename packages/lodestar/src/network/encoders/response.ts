import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {P2pErrorMessage, ResponseBody} from "@chainsafe/lodestar-types";
import {ILogger, LodestarError} from "@chainsafe/lodestar-utils";
import {AbortController} from "abort-controller";
import varint from "varint";
import {Method, MethodResponseType, Methods, ReqRespEncoding, RequestId, RpcResponseStatus} from "../../constants";
import {IResponseChunk} from "./interface";
import {decodeP2pErrorMessage} from "./errorMessage";
import {encodeResponseStatus, getCompressor} from "./utils";
import {BufferedSource} from "./bufferedSource";
import {readChunk} from "./encoding";

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
    const type = Methods[method].responseSSZType(config);
    const isSszTree = method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot;

    // A requester SHOULD read from the stream until either:
    // 1. An error result is received in one of the chunks (the error payload MAY be read before stopping).
    // 2. The responder closes the stream.
    // 3. Any part of the response_chunk fails validation.
    // 4. The maximum number of requested chunks are read.

    try {
      const bufferedSource = new BufferedSource(source as AsyncGenerator<Buffer>);
      const maxItems = Methods[method].responseType === MethodResponseType.SingleResponse ? 1 : Infinity;

      for (let i = 0; i < maxItems && !bufferedSource.isDone; i++) {
        await readResultHeader(bufferedSource);
        yield await readChunk(bufferedSource, encoding, type, {isSszTree});
      }

      await bufferedSource.return();
    } catch (e) {
      // # TODO: Append method and requestId to error here
      logger.warn("eth2ResponseDecode", {method, requestId}, e);
    } finally {
      controller.abort();
    }
  };
}

async function readResultHeader(bufferedSource: BufferedSource): Promise<RpcResponseStatus.SUCCESS> {
  for await (const buffer of bufferedSource) {
    const status = buffer.get(0);
    buffer.consume(1);

    // If first chunk had zero bytes status === null, get next
    if (status === null) {
      continue;
    }

    // For multiple chunks, only the last chunk is allowed to have a non-zero error
    // code (i.e. The chunk stream is terminated once an error occurs
    if (status === RpcResponseStatus.SUCCESS) {
      return RpcResponseStatus.SUCCESS;
    }

    // No bytes left to consume, get next bytes for ErrorMessage
    if (buffer.length === 0) {
      continue;
    }

    try {
      const errorMessage = decodeP2pErrorMessage(buffer.slice());
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.RECEIVED_ERROR_STATUS, status, errorMessage});
    } catch (e) {
      throw new ResponseDecodeError({code: ResponseDecodeErrorCode.FAILED_DECODE_ERROR, status, error: e});
    }
  }

  throw Error("Stream ended early");
}

export enum ResponseDecodeErrorCode {
  /** Response had no status SUCCESS and error message was successfully decoded */
  FAILED_DECODE_ERROR = "RESPONSE_DECODE_ERROR_FAILED_DECODE_ERROR",
  /** Response had no status SUCCESS and error message was successfully decoded */
  RECEIVED_ERROR_STATUS = "RESPONSE_DECODE_ERROR_RECEIVED_STATUS",
}

type ResponseDecodeErrorType =
  | {code: ResponseDecodeErrorCode.FAILED_DECODE_ERROR; status: number; error: Error}
  | {code: ResponseDecodeErrorCode.RECEIVED_ERROR_STATUS; status: number; errorMessage: string};

export class ResponseDecodeError extends LodestarError<ResponseDecodeErrorType> {
  constructor(type: ResponseDecodeErrorType) {
    super(type);
  }
}
