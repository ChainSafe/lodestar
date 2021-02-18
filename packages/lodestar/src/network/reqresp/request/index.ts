import {AbortSignal} from "abort-controller";
import {source as abortSource} from "abortable-iterator";
import pipe from "it-pipe";
import PeerId from "peer-id";
import {RequestBody, ResponseBody} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ErrorAborted, ILogger, Context, withTimeout, TimeoutError} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding, timeoutOptions} from "../../../constants";
import {createRpcProtocol} from "../../util";
import {ResponseError} from "../response";
import {requestEncode} from "../encoders/requestEncode";
import {responseDecode} from "../encoders/responseDecode";
import {ILibP2pStream} from "../interface";
import {collectResponses} from "./collectResponses";
import {responseTimeoutsHandler} from "./responseTimeoutsHandler";
import {
  RequestError,
  RequestErrorCode,
  RequestInternalError,
  IRequestErrorMetadata,
  responseStatusErrorToRequestError,
} from "./errors";

export {RequestError, RequestErrorCode};

/**
 * Sends ReqResp request to a peer. Throws on error. Logs each step of the request lifecycle.
 *
 * 1. Dial peer, establish duplex stream
 * 2. Encoded and write request to peer. Expect the responder to close the stream's write side
 * 3. Read and decode reponse(s) from peer. Will close the read stream if:
 *    - An error result is received in one of the chunks. Reads the error_message and throws.
 *    - The responder closes the stream. If at the end or start of a <response_chunk>, return. Otherwise throws
 *    - Any part of the response_chunk fails validation. Throws a typed error (see `SszSnappyError`)
 *    - The maximum number of requested chunks are read. Does not throw, returns read chunks only.
 */
export async function sendRequest<T extends ResponseBody | ResponseBody[]>(
  {libp2p, config, logger}: {libp2p: LibP2p; config: IBeaconConfig; logger: ILogger},
  peerId: PeerId,
  method: Method,
  encoding: ReqRespEncoding,
  requestBody: RequestBody,
  maxResponses?: number,
  signal?: AbortSignal,
  options?: Partial<typeof timeoutOptions>,
  requestId = 0
): Promise<T> {
  const {REQUEST_TIMEOUT, DIAL_TIMEOUT} = {...timeoutOptions, ...options};
  const peer = peerId.toB58String();
  const logCtx = {method, encoding, peer, requestId};
  const protocol = createRpcProtocol(method, encoding);

  if (signal?.aborted) {
    throw new ErrorAborted("sendRequest");
  }

  logger.debug("Req  dialing peer", logCtx);

  try {
    // As of October 2020 we can't rely on libp2p.dialProtocol timeout to work so
    // this function wraps the dialProtocol promise with an extra timeout
    //
    // > The issue might be: you add the peer's addresses to the AddressBook,
    //   which will result in autoDial to kick in and dial your peer. In parallel,
    //   you do a manual dial and it will wait for the previous one without using
    //   the abort signal:
    //
    // https://github.com/ChainSafe/lodestar/issues/1597#issuecomment-703394386

    // DIAL_TIMEOUT: Non-spec timeout from dialing protocol until stream opened
    const stream = await withTimeout(
      async (timeoutAndParentSignal) => {
        const conn = await libp2p.dialProtocol(peerId, protocol, {signal: timeoutAndParentSignal});
        if (!conn) throw Error("dialProtocol timeout");
        return (conn as {stream: ILibP2pStream}).stream;
      },
      DIAL_TIMEOUT,
      signal
    ).catch((e) => {
      if (e instanceof TimeoutError) {
        throw new RequestInternalError({code: RequestErrorCode.DIAL_TIMEOUT});
      } else {
        throw new RequestInternalError({code: RequestErrorCode.DIAL_ERROR, error: e});
      }
    });

    logger.debug("Req  sending request", {...logCtx, requestBody} as Context);

    // Spec: The requester MUST close the write side of the stream once it finishes writing the request message
    // Impl: stream.sink should be closed automatically by js-libp2p-mplex when piped source returns

    // REQUEST_TIMEOUT: Non-spec timeout from sending request until write stream closed by responder
    await withTimeout(
      async (timeoutAndParentSignal) =>
        await pipe(
          abortSource(requestEncode(config, method, encoding, requestBody), timeoutAndParentSignal),
          stream.sink
        ),
      REQUEST_TIMEOUT,
      signal
    ).catch((e) => {
      // Must close the stream read side (stream.source) manually
      stream.close();

      if (e instanceof TimeoutError) {
        throw new RequestInternalError({code: RequestErrorCode.REQUEST_TIMEOUT});
      } else {
        throw new RequestInternalError({code: RequestErrorCode.REQUEST_ERROR, error: e});
      }
    });

    logger.debug("Req  request sent", logCtx);

    const responses = await pipe(
      abortSource(stream.source, signal),
      responseTimeoutsHandler(responseDecode(config, method, encoding), options),
      collectResponses(method, maxResponses)
    );

    // NOTE: Only log once per request to verbose, intermediate steps to debug
    // NOTE: Do not log the response, logs get extremely cluttered
    // NOTE: add double space after "Req  " to match "Resp "
    logger.verbose("Req  done", logCtx);

    return responses as T;

    // No need to call `stream.close()` here on finally {} to handle stream.source,
    // libp2p-mplex will .end() the source (it-pushable instance) for errors and returns
  } catch (e) {
    logger.verbose("Req  error", logCtx, e);

    const metadata: IRequestErrorMetadata = {method, encoding, peer};

    if (e instanceof ResponseError) {
      throw new RequestError(responseStatusErrorToRequestError(e), metadata);
    } else if (e instanceof RequestInternalError) {
      throw new RequestError(e.type, metadata);
    } else {
      throw e;
    }
  }
}
