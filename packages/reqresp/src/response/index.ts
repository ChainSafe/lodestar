import {pipe} from "it-pipe";
import {PeerId, Stream} from "@libp2p/interface";
import {Uint8ArrayList} from "uint8arraylist";
import {Logger, TimeoutError, withTimeout} from "@lodestar/utils";
import {prettyPrintPeerId} from "../utils/index.js";
import {Protocol, ReqRespRequest} from "../types.js";
import {requestDecode} from "../encoders/requestDecode.js";
import {responseEncodeError, responseEncodeSuccess} from "../encoders/responseEncode.js";
import {RespStatus} from "../interface.js";
import {RequestError, RequestErrorCode} from "../request/errors.js";
import {ReqRespRateLimiter} from "../rate_limiter/ReqRespRateLimiter.js";
import {Metrics} from "../metrics.js";
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
 * Handles a ReqResp request from a peer. Throws on error. Logs each step of the response lifecycle.
 *
 * 1. A duplex `stream` with the peer is already available
 * 2. Read and decode request from peer
 * 3. Delegate to `performRequestHandler()` to perform the request job and expect
 *    to yield zero or more `<response_chunks>`
 * 4a. Encode and write `<response_chunks>` to peer
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

  const logCtx = {method: protocol.method, client: peerClient, peer: prettyPrintPeerId(peerId), requestId};

  let responseError: Error | null = null;
  await pipe(
    // Yields success chunks and error chunks in the same generator
    // This syntax allows to recycle stream.sink to send success and error chunks without returning
    // in case request whose body is a List fails at chunk_i > 0, without breaking out of the for..await..of
    (async function* requestHandlerSource() {
      try {
        // TODO: Does the TTFB timer start on opening stream or after receiving request
        const timerTTFB = metrics?.outgoingResponseTTFB.startTimer({method: protocol.method});

        const requestBody = await withTimeout(
          () => pipe(stream.source as AsyncIterable<Uint8ArrayList>, requestDecode(protocol)),
          REQUEST_TIMEOUT,
          signal
        ).catch((e: unknown) => {
          if (e instanceof TimeoutError) {
            throw e; // Let outter catch (_e) {} re-type the error as SERVER_ERROR
          } else {
            throw new ResponseError(RespStatus.INVALID_REQUEST, (e as Error).message);
          }
        });

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

        yield* pipe(
          // TODO: Debug the reason for type conversion here
          protocol.handler(requestChunk, peerId),
          // NOTE: Do not log the resp chunk contents, logs get extremely cluttered
          // Note: Not logging on each chunk since after 1 year it hasn't add any value when debugging
          // onChunk(() => logger.debug("Resp sending chunk", logCtx)),
          responseEncodeSuccess(protocol, {
            onChunk(chunkIndex) {
              if (chunkIndex === 0) timerTTFB?.();
            },
          })
        );
      } catch (e) {
        const status = e instanceof ResponseError ? e.status : RespStatus.SERVER_ERROR;
        yield* responseEncodeError(protocol, status, (e as Error).message);

        // Should not throw an error here or libp2p-mplex throws with 'AbortError: stream reset'
        // throw e;
        responseError = e as Error;
      }
    })(),
    stream.sink
  );

  // If streak.sink throws, libp2p-mplex will close stream.source
  // If `requestDecode()` throws the stream.source must be closed manually
  // To ensure the stream.source it-pushable instance is always closed, stream.close() is called always
  await stream.close();

  // TODO: It may happen that stream.sink returns before returning stream.source first,
  // so you never see "Resp received request" in the logs and the response ends without
  // sending any chunk, triggering EMPTY_RESPONSE error on the requesting side
  // It has only happened when doing a request too fast upon immediate connection on inbound peer
  // investigate a potential race condition there

  if (responseError !== null) {
    logger.verbose("Resp error", logCtx, responseError);
    throw responseError;
  } else {
    // NOTE: Only log once per request to verbose, intermediate steps to debug
    logger.verbose("Resp done", logCtx);
  }
}
