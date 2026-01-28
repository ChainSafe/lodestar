import {PeerId, Stream} from "@libp2p/interface";
import {byteStream} from "@libp2p/utils";
import {Logger, TimeoutError, withTimeout} from "@lodestar/utils";
import {decodeRequest} from "../encoders/requestDecode.js";
import {encodeResponseChunk, encodeErrorResponse} from "../encoders/responseEncode.js";
import {RespStatus} from "../interface.js";
import {Metrics} from "../metrics.js";
import {ReqRespRateLimiter} from "../rate_limiter/ReqRespRateLimiter.js";
import {RequestError, RequestErrorCode} from "../request/errors.js";
import {Protocol, ReqRespRequest} from "../types.js";
import {prettyPrintPeerId} from "../utils/index.js";
import {ResponseError} from "./errors.js";

export {ResponseError};

// Default spec values from https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/phase0/p2p-interface.md#configuration
export const DEFAULT_REQUEST_TIMEOUT = 5 * 1000; // 5 sec

export interface HandleRequestOpts {
  logger: Logger;
  metrics: Metrics | null;
  stream: Stream;
  peerId: PeerId;
  protocol: Protocol;
  protocolID: string;
  rateLimiter: ReqRespRateLimiter;
  signal?: AbortSignal;
  requestId?: number;
  /** Peer client type for logging and metrics: 'prysm' | 'lighthouse' */
  peerClient?: string;
  /** Non-spec timeout from sending request until write stream closed by responder */
  requestTimeoutMs?: number;
}

/**
 * Handles a ReqResp request from a peer using libp2p v3 stream API.
 * Uses byteStream() for imperative read/write operations.
 *
 * 1. A duplex `stream` with the peer is already available
 * 2. Read and decode request from peer using byteStream().read()
 * 3. Delegate to `handler()` to perform the request job and expect
 *    to yield zero or more `<response_chunks>`
 * 4a. Encode and write `<response_chunks>` to peer using byteStream().write()
 * 4b. On error, encode and write an error `<response_chunk>` and stop
 */
export async function handleRequest({
  logger,
  metrics,
  stream,
  peerId,
  protocol,
  protocolID,
  rateLimiter,
  signal,
  requestId = 0,
  peerClient = "unknown",
  requestTimeoutMs,
}: HandleRequestOpts): Promise<void> {
  const REQUEST_TIMEOUT = requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;

  const logCtx = {
    method: protocol.method,
    version: protocol.version,
    client: peerClient,
    peer: prettyPrintPeerId(peerId),
    requestId,
  };
  metrics?.incomingOpenedStreams.inc({method: protocol.method});

  // Use byteStream for imperative read/write with libp2p v3
  const bytes = byteStream(stream);
  let responseError: Error | null = null;

  try {
    const timerTTFB = metrics?.outgoingResponseTTFB.startTimer({method: protocol.method});

    // Read and decode request with timeout
    let requestBody: Uint8Array;
    try {
      requestBody = await withTimeout(
        async () => decodeRequest(bytes, protocol, signal),
        REQUEST_TIMEOUT,
        signal
      );
    } catch (e: unknown) {
      if (e instanceof TimeoutError) {
        throw e; // Let outer catch re-type the error as SERVER_ERROR
      }
      throw new ResponseError(RespStatus.INVALID_REQUEST, (e as Error).message);
    }

    logger.debug("Req  received", logCtx);

    // Max count by request for byRange and byRoot
    const requestCount = protocol?.inboundRateLimits?.getRequestCount?.(requestBody) ?? 1;

    if (!rateLimiter.allows(peerId, protocolID, requestCount)) {
      throw new RequestError({code: RequestErrorCode.REQUEST_RATE_LIMITED});
    }

    const requestChunk: ReqRespRequest = {
      data: requestBody,
      version: protocol.version,
    };

    // Process handler and encode/write responses
    let chunkIndex = 0;
    for await (const chunk of protocol.handler(requestChunk, peerId, peerClient)) {
      if (chunkIndex === 0) timerTTFB?.();

      // Encode success response chunk: <result=0> | <context-bytes>? | <varint-length> | <snappy-frames(ssz-payload)>
      const encodedChunk = encodeResponseChunk(protocol, chunk);
      await bytes.write(encodedChunk, {signal});

      chunkIndex++;
    }
  } catch (e) {
    const status = e instanceof ResponseError ? e.status : RespStatus.SERVER_ERROR;
    
    // Encode and write error response: <result> | <error_message>?
    const errorChunk = encodeErrorResponse(protocol, status, (e as Error).message);
    try {
      await bytes.write(errorChunk, {signal});
    } catch {
      // Ignore write errors when sending error response
    }

    responseError = e as Error;
  } finally {
    // Ensure stream is properly closed
    await stream.close();
    metrics?.incomingClosedStreams.inc({method: protocol.method});
  }

  if (responseError !== null) {
    logger.verbose("Resp error", logCtx, responseError);
    throw responseError;
  }
  // NOTE: Only log once per request to verbose, intermediate steps to debug
  logger.verbose("Resp done", logCtx);
}
