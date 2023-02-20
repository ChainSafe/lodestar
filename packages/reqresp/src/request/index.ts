import {pipe} from "it-pipe";
import {PeerId} from "@libp2p/interface-peer-id";
import {Libp2p} from "libp2p";
import {Uint8ArrayList} from "uint8arraylist";
import {ErrorAborted, Logger, withTimeout, TimeoutError} from "@lodestar/utils";
import {ProtocolDefinition} from "../types.js";
import {prettyPrintPeerId, abortableSource} from "../utils/index.js";
import {ResponseError} from "../response/index.js";
import {requestEncode} from "../encoders/requestEncode.js";
import {responseDecode} from "../encoders/responseDecode.js";
import {
  RequestError,
  RequestErrorCode,
  RequestInternalError,
  RequestErrorMetadata,
  responseStatusErrorToRequestError,
} from "./errors.js";

export {RequestError, RequestErrorCode};

// Default spec values from https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/phase0/p2p-interface.md#configuration
export const DEFAULT_DIAL_TIMEOUT = 5 * 1000; // 5 sec
export const DEFAULT_REQUEST_TIMEOUT = 5 * 1000; // 5 sec
export const DEFAULT_TTFB_TIMEOUT = 5 * 1000; // 5 sec
export const DEFAULT_RESP_TIMEOUT = 10 * 1000; // 10 sec

export interface SendRequestOpts {
  /** The maximum time for complete response transfer. */
  respTimeoutMs?: number;
  /** Non-spec timeout from sending request until write stream closed by responder */
  requestTimeoutMs?: number;
  /** The maximum time to wait for first byte of request response (time-to-first-byte). */
  ttfbTimeoutMs?: number;
  /** Non-spec timeout from dialing protocol until stream opened */
  dialTimeoutMs?: number;
}

type SendRequestModules = {
  logger: Logger;
  libp2p: Libp2p;
  peerClient?: string;
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
export async function* sendRequest<Req, Resp>(
  {logger, libp2p, peerClient}: SendRequestModules,
  peerId: PeerId,
  protocols: ProtocolDefinition[],
  protocolIDs: string[],
  requestBody: Req,
  signal?: AbortSignal,
  opts?: SendRequestOpts,
  requestId = 0
): AsyncIterable<Resp> {
  if (protocols.length === 0) {
    throw Error("sendRequest must set > 0 protocols");
  }

  const DIAL_TIMEOUT = opts?.dialTimeoutMs ?? DEFAULT_DIAL_TIMEOUT;
  const REQUEST_TIMEOUT = opts?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;
  const TTFB_TIMEOUT = opts?.ttfbTimeoutMs ?? DEFAULT_TTFB_TIMEOUT;
  const RESP_TIMEOUT = opts?.respTimeoutMs ?? DEFAULT_RESP_TIMEOUT;

  const peerIdStr = peerId.toString();
  const peerIdStrShort = prettyPrintPeerId(peerId);
  const {method, encoding} = protocols[0];
  const logCtx = {method, encoding, client: peerClient, peer: peerIdStrShort, requestId};

  if (signal?.aborted) {
    throw new ErrorAborted("sendRequest");
  }

  logger.debug("Req  dialing peer", logCtx);

  try {
    // From Altair block query methods have V1 and V2. Both protocols should be requested.
    // On stream negotiation `libp2p.dialProtocol` will pick the available protocol and return
    // the picked protocol in `connection.protocol`
    const protocolsMap = new Map<string, ProtocolDefinition>(
      protocols.map((protocol, i) => [protocolIDs[i], protocol])
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
    const stream = await withTimeout(
      async (timeoutAndParentSignal) => {
        const protocolIds = Array.from(protocolsMap.keys());
        const conn = await libp2p.dialProtocol(peerId, protocolIds, {signal: timeoutAndParentSignal});
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        if (!conn) throw Error("dialProtocol timeout");
        return conn;
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
    const protocolId = stream.stat.protocol ?? "unknown";
    const protocol = protocolsMap.get(protocolId);
    if (!protocol) throw Error(`dialProtocol selected unknown protocolId ${protocolId}`);

    logger.debug("Req  sending request", {...logCtx, body: protocol.renderRequestBody?.(requestBody)});

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

    // For goodbye method peers may disconnect before completing the response and trigger multiple errors.
    // Do not expect them to reply and successfully return early
    if (protocol.ignoreResponse) {
      return;
    }

    // - TTFB_TIMEOUT: The requester MUST wait a maximum of TTFB_TIMEOUT for the first response byte to arrive
    // - RESP_TIMEOUT: Requester allows a further RESP_TIMEOUT for each subsequent response_chunk
    // - Max total timeout: This timeout is not required by the spec. It may not be necessary, but it's kept as
    //   safe-guard to close. streams in case of bugs on other timeout mechanisms.
    const ttfbTimeoutController = new AbortController();
    const respTimeoutController = new AbortController();

    const timeoutTTFB = setTimeout(() => ttfbTimeoutController.abort(), TTFB_TIMEOUT);
    let timeoutRESP: NodeJS.Timeout | null = null;

    const restartRespTimeout = (): void => {
      if (timeoutRESP) clearTimeout(timeoutRESP);
      timeoutRESP = setTimeout(() => respTimeoutController.abort(), RESP_TIMEOUT);
    };

    try {
      // Note: libp2p.stop() will close all connections, so not necessary to abort this pipe on parent stop
      yield* pipe(
        abortableSource(stream.source as AsyncIterable<Uint8ArrayList>, [
          {
            signal: ttfbTimeoutController.signal,
            getError: () => new RequestInternalError({code: RequestErrorCode.TTFB_TIMEOUT}),
          },
          {
            signal: respTimeoutController.signal,
            getError: () => new RequestInternalError({code: RequestErrorCode.RESP_TIMEOUT}),
          },
        ]),

        // Transforms `Buffer` chunks to yield `ResponseBody` chunks
        responseDecode(protocol, {
          onFirstHeader() {
            // On first byte, cancel the single use TTFB_TIMEOUT, and start RESP_TIMEOUT
            clearTimeout(timeoutTTFB);
            restartRespTimeout();
          },
          onFirstResponseChunk() {
            // On <response_chunk>, cancel this chunk's RESP_TIMEOUT and start next's
            restartRespTimeout();
          },
        })
      );

      // NOTE: Only log once per request to verbose, intermediate steps to debug
      // NOTE: Do not log the response, logs get extremely cluttered
      // NOTE: add double space after "Req  " to align log with the "Resp " log
      logger.verbose("Req  done", {...logCtx});
    } finally {
      clearTimeout(timeoutTTFB);
      if (timeoutRESP !== null) clearTimeout(timeoutRESP);

      // Necessary to call `stream.close()` since collectResponses() may break out of the source before exhausting it
      // `stream.close()` libp2p-mplex will .end() the source (it-pushable instance)
      // If collectResponses() exhausts the source, it-pushable.end() can be safely called multiple times
      stream.close();
    }
  } catch (e) {
    logger.verbose("Req  error", logCtx, e as Error);

    const metadata: RequestErrorMetadata = {method, encoding, peer: peerIdStr};

    if (e instanceof ResponseError) {
      throw new RequestError(responseStatusErrorToRequestError(e), metadata);
    } else if (e instanceof RequestInternalError) {
      throw new RequestError(e.type, metadata);
    } else {
      throw e;
    }
  }
}
