import type {Stream} from "@libp2p/interface";
import {PeerId} from "@libp2p/interface";
import type {Libp2p} from "libp2p";
import {ErrorAborted, Logger, TimeoutError, withTimeout} from "@lodestar/utils";
import {requestEncode} from "../encoders/requestEncode.js";
import {responseDecode} from "../encoders/responseDecode.js";
import {Metrics} from "../metrics.js";
import {ResponseError} from "../response/index.js";
import {MixedProtocol, ResponseIncoming} from "../types.js";
import {prettyPrintPeerId, sendChunks} from "../utils/index.js";
import {RequestError, RequestErrorCode, responseStatusErrorToRequestError} from "./errors.js";

export {RequestError, RequestErrorCode};

// https://github.com/ethereum/consensus-specs/blob/v1.6.1/specs/phase0/p2p-interface.md#the-reqresp-domain
export const DEFAULT_DIAL_TIMEOUT = 5 * 1000; // 5 sec
export const DEFAULT_REQUEST_TIMEOUT = 5 * 1000; // 5 sec
export const DEFAULT_RESP_TIMEOUT = 10 * 1000; // 10 sec

function getStreamNotFullyConsumedError(): Error {
  return new Error("ReqResp stream was not fully consumed");
}

function scheduleStreamAbortIfNotClosed(stream: Stream, timeoutMs: number): void {
  const onClose = (): void => {
    clearTimeout(timeout);
  };

  const timeout = setTimeout(() => {
    stream.removeEventListener("close", onClose);
    if (stream.status === "open" && stream.remoteWriteStatus === "writable") {
      stream.abort(getStreamNotFullyConsumedError());
    }
  }, timeoutMs);

  stream.addEventListener("close", onClose, {once: true});
}

export interface SendRequestOpts {
  /** The maximum time for complete response transfer. */
  respTimeoutMs?: number;
  /** Non-spec timeout from sending request until write stream closed by responder */
  requestTimeoutMs?: number;
  /** Non-spec timeout from dialing protocol until stream opened */
  dialTimeoutMs?: number;
}

type SendRequestModules = {
  logger: Logger;
  libp2p: Libp2p;
  metrics: Metrics | null;
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
export async function* sendRequest(
  {logger, libp2p, metrics, peerClient}: SendRequestModules,
  peerId: PeerId,
  protocols: MixedProtocol[],
  protocolIDs: string[],
  requestBody: Uint8Array,
  signal?: AbortSignal,
  opts?: SendRequestOpts,
  requestId = 0
): AsyncIterable<ResponseIncoming> {
  if (protocols.length === 0) {
    throw Error("sendRequest must set > 0 protocols");
  }

  const DIAL_TIMEOUT = opts?.dialTimeoutMs ?? DEFAULT_DIAL_TIMEOUT;
  const REQUEST_TIMEOUT = opts?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;
  const RESP_TIMEOUT = opts?.respTimeoutMs ?? DEFAULT_RESP_TIMEOUT;

  const peerIdStrShort = prettyPrintPeerId(peerId);
  const {method, encoding, version} = protocols[0];
  const logCtx = {method, version, encoding, client: peerClient, peer: peerIdStrShort, requestId};

  if (signal?.aborted) {
    throw new ErrorAborted("sendRequest");
  }

  logger.debug("Req  dialing peer", logCtx);

  try {
    // From Altair block query methods have V1 and V2. Both protocols should be requested.
    // On stream negotiation `libp2p.dialProtocol` will pick the available protocol and return
    // the picked protocol in `connection.protocol`
    const protocolsMap = new Map<string, MixedProtocol>(protocols.map((protocol, i) => [protocolIDs[i], protocol]));

    const stream = await withTimeout(
      async (timeoutAndParentSignal) => {
        const protocolIds = Array.from(protocolsMap.keys());
        const conn = await libp2p.dialProtocol(peerId, protocolIds, {signal: timeoutAndParentSignal});
        if (!conn) throw Error("dialProtocol timeout");
        return conn;
      },
      DIAL_TIMEOUT,
      signal
    ).catch((e: Error) => {
      if (e instanceof TimeoutError) {
        throw new RequestError({code: RequestErrorCode.DIAL_TIMEOUT});
      }
      throw new RequestError({code: RequestErrorCode.DIAL_ERROR, error: e});
    });

    metrics?.outgoingOpenedStreams?.inc({method});

    // Parse protocol selected by the responder
    const protocolId = stream.protocol ?? "unknown";
    const protocol = protocolsMap.get(protocolId);
    if (!protocol) throw Error(`dialProtocol selected unknown protocolId ${protocolId}`);

    // Override with actual version that was negotiated
    logCtx.version = protocol.version;

    logger.debug("Req  sending request", logCtx);

    // Spec: The requester MUST close the write side of the stream once it finishes writing the request message

    // REQUEST_TIMEOUT: Non-spec timeout from sending request until write stream closed by responder
    // Note: libp2p.stop() will close all connections, so not necessary to abort this send on parent stop
    await withTimeout(
      async (timeoutAndParentSignal) => {
        await sendChunks(stream, requestEncode(protocol, requestBody), timeoutAndParentSignal);
        await stream.close({signal: timeoutAndParentSignal});
      },
      REQUEST_TIMEOUT,
      signal
    ).catch((e) => {
      stream.abort(e as Error);

      if (e instanceof TimeoutError) {
        throw new RequestError({code: RequestErrorCode.REQUEST_TIMEOUT});
      }
      throw new RequestError({code: RequestErrorCode.REQUEST_ERROR, error: e as Error});
    });

    logger.debug("Req  request sent", logCtx);

    // For goodbye method peers may disconnect before completing the response and trigger multiple errors.
    // Do not expect them to reply and successfully return early
    if (protocol.ignoreResponse) {
      return;
    }

    // RESP_TIMEOUT: Maximum time for complete response transfer
    const respSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(RESP_TIMEOUT)])
      : AbortSignal.timeout(RESP_TIMEOUT);

    let responseError: Error | null = null;
    let responseFullyConsumed = false;

    try {
      yield* responseDecode(protocol, stream, {
        signal: respSignal,
        getError: () =>
          signal?.aborted ? new ErrorAborted("sendRequest") : new RequestError({code: RequestErrorCode.RESP_TIMEOUT}),
      });
      responseFullyConsumed = true;

      // NOTE: Only log once per request to verbose, intermediate steps to debug
      // NOTE: Do not log the response, logs get extremely cluttered
      // NOTE: add double space after "Req  " to align log with the "Resp " log
      logger.verbose("Req  done", logCtx);
    } catch (e) {
      responseError = e as Error;
      throw e;
    } finally {
      // On decode/timeout failures abort immediately so mplex can reclaim stream state.
      // On normal early consumer exit, close gracefully to avoid stream-id desync with peers.
      if (responseError !== null || signal?.aborted) {
        stream.abort(responseError ?? new ErrorAborted("sendRequest"));
      } else {
        await stream.close().catch((e) => {
          stream.abort(e as Error);
        });

        if (!responseFullyConsumed) {
          // Stop buffering unread inbound data after caller exits early.
          // mplex does not support propagating closeRead to the remote, so still
          // abort later if the remote never closes write.
          await stream.closeRead().catch(() => {
            // Ignore closeRead errors - close/abort path below will reclaim stream.
          });

          if (stream.remoteWriteStatus === "writable") {
            scheduleStreamAbortIfNotClosed(stream, RESP_TIMEOUT);
          }
        }
      }
      metrics?.outgoingClosedStreams?.inc({method});
      logger.verbose("Req  stream closed", logCtx);
    }
  } catch (e) {
    logger.verbose("Req  error", logCtx, e as Error);

    if (e instanceof ResponseError) {
      throw new RequestError(responseStatusErrorToRequestError(e));
    }
    throw e;
  }
}
