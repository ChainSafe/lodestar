import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, Methods, ReqRespEncoding, RpcResponseStatus} from "../../../constants";
import {IResponseChunk} from "../interface";
import {writeChunk} from "../encodingStrategies";
import {ResponseBody} from "@chainsafe/lodestar-types";

// request         ::= <encoding-dependent-header> | <encoded-payload>
// response        ::= <response_chunk>*
// response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
// result          ::= “0” | “1” | “2” | [“128” ... ”255”]

// `response` has zero or more chunks for SSZ-list responses or exactly one chunk for non-list

export function responseEncode(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<IResponseChunk>) => AsyncIterable<Buffer> {
  const type = Methods[method].responseSSZType(config);

  return async function* (source) {
    // Must yield status and length separate so recipient knows how much frames
    // it needs to decompress. With compression we are sending compressed data
    // frame by frame
    for await (const chunk of source) {
      yield Buffer.from([status]);

      if (chunk.status !== RpcResponseStatus.SUCCESS) {
        if (chunk.errorMessage) {
          yield Buffer.from(chunk.errorMessage);
        }
        break;
      }

      if (type) {
        yield* writeChunk(chunk.body, encoding, type);
      }
    }
  };
}

export function responseEncodeSuccess(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<ResponseBody>) => AsyncIterable<Buffer> {
  const type = Methods[method].responseSSZType(config);

  return async function* (source) {
    // Must yield status and length separate so recipient knows how much frames
    // it needs to decompress. With compression we are sending compressed data
    // frame by frame
    for await (const chunk of source) {
      yield Buffer.from([RpcResponseStatus.SUCCESS]);

      if (type) {
        yield* writeChunk(chunk, encoding, type);
      }
    }
  };
}

export async function* responseEncodeError(
  status: Exclude<RpcResponseStatus, RpcResponseStatus.SUCCESS>,
  errorMessage: string
): AsyncGenerator<Buffer> {
  yield Buffer.from([status]);

  if (errorMessage) {
    yield Buffer.from(errorMessage);
  }
}
