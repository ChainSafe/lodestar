import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {AbortController} from "abort-controller";
import {Method, MethodResponseType, Methods, ReqRespEncoding, RequestId} from "../../../constants";
import {BufferedSource} from "../utils/bufferedSource";
import {readChunk} from "../encodingStrategies";
import {readResultHeader} from "./resultHeader";

// request         ::= <encoding-dependent-header> | <encoded-payload>
// response        ::= <response_chunk>*
// response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
// result          ::= “0” | “1” | “2” | [“128” ... ”255”]

// `response` has zero or more chunks for SSZ-list responses or exactly one chunk for non-list

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
