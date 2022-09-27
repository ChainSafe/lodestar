import {pipe} from "it-pipe";
import {PeerId} from "@libp2p/interface-peer-id";
import {Stream} from "@libp2p/interface-connection";
import {Uint8ArrayList} from "uint8arraylist";
import {ILogger, TimeoutError, withTimeout} from "@lodestar/utils";
import {IBeaconConfig} from "@lodestar/config";
import {REQUEST_TIMEOUT, RespStatus} from "../../../constants/index.js";
import {prettyPrintPeerId} from "../../util.js";
import {PeersData} from "../../peers/peersData.js";
import {Protocol, RequestBody, OutgoingResponseBody} from "../types.js";
import {renderRequestBody} from "../utils/index.js";
import {requestDecode} from "../encoders/requestDecode.js";
import {responseEncodeError, responseEncodeSuccess} from "../encoders/responseEncode.js";
import {ResponseError} from "./errors.js";

export {ResponseError};

export type PerformRequestHandler = (
  protocol: Protocol,
  requestBody: RequestBody,
  peerId: PeerId
) => AsyncIterable<OutgoingResponseBody>;

type HandleRequestModules = {
  config: IBeaconConfig;
  logger: ILogger;
  peersData: PeersData;
};

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
export async function handleRequest(
  {config, logger, peersData: peersData}: HandleRequestModules,
  performRequestHandler: PerformRequestHandler,
  stream: Stream,
  peerId: PeerId,
  protocol: Protocol,
  signal?: AbortSignal,
  requestId = 0
): Promise<void> {
  const client = peersData.getPeerKind(peerId.toString());
  const logCtx = {method: protocol.method, client, peer: prettyPrintPeerId(peerId), requestId};

  let responseError: Error | null = null;
  await pipe(
    // Yields success chunks and error chunks in the same generator
    // This syntax allows to recycle stream.sink to send success and error chunks without returning
    // in case request whose body is a List fails at chunk_i > 0, without breaking out of the for..await..of
    (async function* requestHandlerSource() {
      try {
        const requestBody = await withTimeout(
          () => pipe(stream.source as AsyncIterable<Uint8ArrayList>, requestDecode(protocol)),
          REQUEST_TIMEOUT,
          signal
        ).catch((e: unknown) => {
          if (e instanceof TimeoutError) {
            throw e; // Let outter catch {} re-type the error as SERVER_ERROR
          } else {
            throw new ResponseError(RespStatus.INVALID_REQUEST, (e as Error).message);
          }
        });

        logger.debug("Resp received request", {...logCtx, body: renderRequestBody(protocol.method, requestBody)});

        yield* pipe(
          performRequestHandler(protocol, requestBody, peerId),
          // NOTE: Do not log the resp chunk contents, logs get extremely cluttered
          // Note: Not logging on each chunk since after 1 year it hasn't add any value when debugging
          // onChunk(() => logger.debug("Resp sending chunk", logCtx)),
          responseEncodeSuccess(config, protocol)
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
  stream.close();

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
