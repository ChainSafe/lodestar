import {ForkName} from "@lodestar/params";
import {IBeaconConfig} from "@lodestar/config";
import {RespStatus, RpcResponseStatusError} from "../../../constants/index.js";
import {writeEncodedPayload} from "../encodingStrategies/index.js";
import {encodeErrorMessage} from "../utils/index.js";
import {
  ContextBytesType,
  contextBytesTypeByProtocol,
  getOutgoingSerializerByMethod,
  IncomingResponseBodyByMethod,
  Method,
  OutgoingResponseBody,
  OutgoingResponseBodyByMethod,
  Protocol,
  ResponseTypedContainer,
} from "../types.js";

/**
 * Yields byte chunks for a `<response>` with a zero response code `<result>`
 * ```bnf
 * response        ::= <response_chunk>*
 * response_chunk  ::= <result> | <context-bytes> | <encoding-dependent-header> | <encoded-payload>
 * result          ::= "0"
 * ```
 * Note: `response` has zero or more chunks (denoted by `<>*`)
 */
export function responseEncodeSuccess(
  config: IBeaconConfig,
  protocol: Protocol
): (source: AsyncIterable<OutgoingResponseBody>) => AsyncIterable<Buffer> {
  const contextBytesType = contextBytesTypeByProtocol(protocol);

  return async function* responseEncodeSuccessTransform(source) {
    for await (const chunk of source) {
      // <result>
      yield Buffer.from([RespStatus.SUCCESS]);

      // <context-bytes> - from altair
      const forkName = getForkNameFromResponseBody(config, protocol, chunk);
      yield* writeContextBytes(config, contextBytesType, forkName);

      // <encoding-dependent-header> | <encoded-payload>
      const serializer = getOutgoingSerializerByMethod(protocol);
      yield* writeEncodedPayload(chunk, protocol.encoding, serializer);
    }
  };
}

/**
 * Yields byte chunks for a `<response_chunk>` with a non-zero response code `<result>`
 * denoted as `<error_response>`
 * ```bnf
 * error_response  ::= <result> | <error_message>?
 * result          ::= "1" | "2" | ["128" ... "255"]
 * ```
 * Only the last `<response_chunk>` is allowed to have a non-zero error code, so this
 * fn yields exactly one `<error_response>` and afterwards the stream must be terminated
 */
export async function* responseEncodeError(
  protocol: Protocol,
  status: RpcResponseStatusError,
  errorMessage: string
): AsyncGenerator<Buffer> {
  // <result>
  yield Buffer.from([status]);

  // <error_message>? is optional
  if (errorMessage) {
    yield* encodeErrorMessage(errorMessage, protocol.encoding);
  }
}

/**
 * Yields byte chunks for a `<context-bytes>`. See `ContextBytesType` for possible types.
 * This item is mandatory but may be empty.
 */
export async function* writeContextBytes(
  config: IBeaconConfig,
  contextBytesType: ContextBytesType,
  forkName: ForkName
): AsyncGenerator<Buffer> {
  switch (contextBytesType) {
    // Yield nothing
    case ContextBytesType.Empty:
      return;

    // Yield a fixed-width 4 byte chunk, set to the `ForkDigest`
    case ContextBytesType.ForkDigest:
      yield config.forkName2ForkDigest(forkName) as Buffer;
  }
}

export function getForkNameFromResponseBody<K extends Method>(
  config: IBeaconConfig,
  protocol: Protocol,
  body: OutgoingResponseBodyByMethod[K] | IncomingResponseBodyByMethod[K]
): ForkName {
  const requestTyped = {method: protocol.method, body} as ResponseTypedContainer;

  switch (requestTyped.method) {
    case Method.Status:
    case Method.Goodbye:
    case Method.Ping:
    case Method.Metadata:
      return ForkName.phase0;

    case Method.BeaconBlocksByRange:
    case Method.BeaconBlocksByRoot:
      return config.getForkName(requestTyped.body.slot);
    case Method.LightClientBootstrap:
    case Method.LightClientUpdate:
    case Method.LightClientFinalityUpdate:
    case Method.LightClientOptimisticUpdate:
      return ForkName.altair;
  }
}
