import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ResponseBody} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding, RpcResponseStatus, RpcResponseStatusError} from "../../../constants";
import {writeEncodedPayload} from "../encodingStrategies";

/**
 * Yields byte chunks for a <response> with a zero response code <result>
 * ```bnf
 * response        ::= <response_chunk>*
 * response_chunk  ::= <result> | <encoding-dependent-header> | <encoded-payload>
 * result          ::= "0"
 * ```
 * Note: `response` has zero or more chunks (denoted by <>*)
 */
export function responseEncodeSuccess(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<ResponseBody>) => AsyncIterable<Buffer> {
  const type = Methods[method].responseSSZType(config);

  return async function* (source) {
    for await (const chunk of source) {
      yield Buffer.from([RpcResponseStatus.SUCCESS]);
      yield* writeEncodedPayload(chunk, encoding, type);
    }
  };
}

/**
 * Yields byte chunks for a <response_chunk> with a non-zero response code <result>
 * denoted as <error_response>
 * ```bnf
 * error_response  ::= <result> | <error_message>?
 * result          ::= "1" | "2" | ["128" ... "255"]
 * ```
 * Only the last <response_chunk> is allowed to have a non-zero error code, so this
 * fn yields exactly one <error_response> and afterwards the stream must be terminated
 */
export async function* responseEncodeError(
  status: RpcResponseStatusError,
  errorMessage: string
): AsyncGenerator<Buffer> {
  yield Buffer.from([status]);

  // errorMessage is optional
  if (errorMessage) {
    yield Buffer.from(errorMessage);
  }
}
