import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, Methods, ReqRespEncoding, RpcResponseStatus} from "../../../constants";
import {IResponseChunk} from "../interface";
import {writeChunk} from "../encodingStrategies";
import {writeResultHeader} from "./resultHeader";

// request         ::= <encoding-dependent-header> | <encoded-payload>
// response        ::= <response_chunk>*
// response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
// result          ::= “0” | “1” | “2” | [“128” ... ”255”]

// `response` has zero or more chunks for SSZ-list responses or exactly one chunk for non-list

export function eth2ResponseEncode(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<IResponseChunk>) => AsyncIterable<Buffer> {
  return async function* (source) {
    const type = Methods[method].responseSSZType(config);
    if (!type) {
      return;
    }

    // Must yield status and length separate so recipient knows how much frames
    // it needs to decompress. With compression we are sending compressed data
    // frame by frame
    for await (const chunk of source) {
      yield* writeResultHeader(chunk.status, chunk.body);
      if (chunk.status !== RpcResponseStatus.SUCCESS) {
        break;
      }

      yield* writeChunk(chunk.body, encoding, type);
    }
  };
}
