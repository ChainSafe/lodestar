import {AbortSignal} from "@chainsafe/abort-controller";
import pipe from "it-pipe";
import PeerId from "peer-id";
import {Libp2p} from "libp2p/src/connection-manager";
import {IForkDigestContext} from "@chainsafe/lodestar-config";
import {ErrorAborted, ILogger, withTimeout, TimeoutError} from "@chainsafe/lodestar-utils";
import {timeoutOptions} from "../../../constants";
import {getClientFromPeerStore, prettyPrintPeerId} from "../../util";
import {Method, Encoding, Protocol, Version, IncomingResponseBody, RequestBody} from "../types";
import {formatProtocolId, renderRequestBody} from "../utils";
import {ResponseError} from "../response";
import {requestEncode} from "../encoders/requestEncode";
import {responseDecode} from "../encoders/responseDecode";
import {Libp2pConnection} from "../interface";
import {collectResponses} from "./collectResponses";
import {maxTotalResponseTimeout, responseTimeoutsHandler} from "./responseTimeoutsHandler";
import {
  RequestError,
  RequestErrorCode,
  RequestInternalError,
  IRequestErrorMetadata,
  responseStatusErrorToRequestError,
} from "./errors";

export {RequestError, RequestErrorCode};

type SendRequestModules = {
  logger: ILogger;
  forkDigestContext: IForkDigestContext;
  libp2p: Libp2p;
};

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
export async function sendRequest<T extends IncomingResponseBody | IncomingResponseBody[]>(
  {logger, forkDigestContext, libp2p}: SendRequestModules,
  peerId: PeerId,
  method: Method,
  encoding: Encoding,
  versions: Version[],
  requestBody: RequestBody,
  maxResponses: number,
  signal?: AbortSignal,
  options?: Partial<typeof timeoutOptions>,
  requestId = 0
): Promise<T> {
  const {REQUEST_TIMEOUT, DIAL_TIMEOUT} = {...timeoutOptions, ...options};
  const peer = prettyPrintPeerId(peerId);
  const client = getClientFromPeerStore(peerId, libp2p.peerStore.metadataBook);
  const logCtx = {method, encoding, client, peer, requestId};

  if (signal?.aborted) {
    throw new ErrorAborted("sendRequest");
  }

  logger.debug("Req  dialing peer", logCtx);

  try {
    // From Altair block query methods have V1 and V2. Both protocols should be requested.
    // On stream negotiation `libp2p.dialProtocol` will pick the available protocol and return
    // the picked protocol in `connection.protocol`
    const protocols = new Map<string, Protocol>(
      versions.map((version) => [formatProtocolId(method, version, encoding), {method, version, encoding}])
    );

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
    const {stream, protocol: protocolId} = await withTimeout(
      async (timeoutAndParentSignal) => {
        const protocolIds = Array.from(protocols.keys());
        const conn = await libp2p.dialProtocol(peerId, protocolIds, {signal: timeoutAndParentSignal});
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!conn) throw Error("dialProtocol timeout");
        // TODO: libp2p-ts type Stream does not declare .abort() and requires casting to unknown here
        // Remove when https://github.com/ChainSafe/lodestar/issues/2167
        // After #2167 upstream types are still not good enough, and require casting
        return (conn as unknown) as Libp2pConnection;
      },
      DIAL_TIMEOUT,
      signal
    ).catch((e: Error) => {
      if (e instanceof TimeoutError) {
        throw new RequestInternalError({code: RequestErrorCode.DIAL_TIMEOUT});
      } else {
        throw new RequestInternalError({code: RequestErrorCode.DIAL_ERROR, error: e as Error});
      }
    });

    // Parse protocol selected by the responder
    const protocol = protocols.get(protocolId);
    if (!protocol) throw Error(`dialProtocol selected unknown protocolId ${protocolId}`);

    logger.debug("Req  sending request", {...logCtx, body: renderRequestBody(method, requestBody)});

    // Spec: The requester MUST close the write side of the stream once it finishes writing the request message
    // Impl: stream.sink is closed automatically by js-libp2p-mplex when piped source is exhausted

    // REQUEST_TIMEOUT: Non-spec timeout from sending request until write stream closed by responder
    // Note: libp2p.stop() will close all connections, so not necessary to abort this pipe on parent stop
    await withTimeout(() => pipe(requestEncode(protocol, requestBody), stream.sink), REQUEST_TIMEOUT, signal).catch(
      (e) => {
        // Must close the stream read side (stream.source) manually AND the write side
        stream.abort(e);

        if (e instanceof TimeoutError) {
          throw new RequestInternalError({code: RequestErrorCode.REQUEST_TIMEOUT});
        } else {
          throw new RequestInternalError({code: RequestErrorCode.REQUEST_ERROR, error: e as Error});
        }
      }
    );

    logger.debug("Req  request sent", logCtx);

    try {
      // Note: libp2p.stop() will close all connections, so not necessary to abort this pipe on parent stop
      const responses = await withTimeout(
        () =>
          pipe(
            stream.source,
            responseTimeoutsHandler(responseDecode(forkDigestContext, protocol), options),
            collectResponses(method, maxResponses)
          ),
        maxTotalResponseTimeout(maxResponses, options)
      ).catch((e: Error) => {
        // No need to close the stream here, the outter finally {} block will
        if (e instanceof TimeoutError) {
          throw new RequestInternalError({code: RequestErrorCode.RESPONSE_TIMEOUT});
        } else {
          throw e; // The error will be typed in the outter catch {} block
        }
      });

      // NOTE: Only log once per request to verbose, intermediate steps to debug
      // NOTE: Do not log the response, logs get extremely cluttered
      // NOTE: add double space after "Req  " to align log with the "Resp " log
      const numResponse = Array.isArray(responses) ? responses.length : 1;
      logger.verbose("Req  done", {...logCtx, numResponse});

      return responses as T;
    } finally {
      // Necessary to call `stream.close()` since collectResponses() may break out of the source before exhausting it
      // `stream.close()` libp2p-mplex will .end() the source (it-pushable instance)
      // If collectResponses() exhausts the source, it-pushable.end() can be safely called multiple times
      stream.close();
    }
  } catch (e) {
    logger.verbose("Req  error", logCtx, e as Error);

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
