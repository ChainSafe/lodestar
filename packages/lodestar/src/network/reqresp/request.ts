import {RequestBody, ResponseBody} from "@chainsafe/lodestar-types";
import {AbortSignal} from "abort-controller";
import {source as abortSource} from "abortable-iterator";
import pipe from "it-pipe";
import PeerId from "peer-id";
import {createRpcProtocol, isRequestOnly, isRequestSingleChunk, randomRequestId} from "..";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ErrorAborted, ILogger, withTimeout} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding, TTFB_TIMEOUT, REQUEST_TIMEOUT, DIAL_TIMEOUT} from "../../constants";
import {ttfbTimeoutController} from "./utils/ttfbTimeoutController";
import {requestEncodeOne} from "./encoders/requestEncode";
import {responseDecode} from "./encoders/responseDecode";
import {ILibP2pStream} from "./interface";

export async function sendRequest<T extends ResponseBody | ResponseBody[]>(
  {libp2p, config, logger}: {libp2p: LibP2p; config: IBeaconConfig; logger: ILogger},
  peerId: PeerId,
  method: Method,
  encoding: ReqRespEncoding,
  requestBody: RequestBody,
  maxResponses?: number,
  signal?: AbortSignal
): Promise<T | null> {
  const logCtx = {method, encoding, peer: peerId.toB58String(), requestId: randomRequestId()};
  const protocol = createRpcProtocol(method, encoding);

  if (signal?.aborted) {
    throw new ErrorAborted("sendRequest");
  }

  logger.verbose("ReqResp dialing peer", logCtx);

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
    e.message = `Failed to dial peer: ${e.message}`;
    throw e;
  });

  logger.verbose("ReqResp sending request", {...logCtx, requestBody});

  // Send request with non-speced REQ_TIMEOUT
  // The requester MUST close the write side of the stream once it finishes writing the request message
  // stream.sink should be closed automatically by js-libp2p-mplex when piped source ends

  try {
    const requestSource = requestEncodeOne(config, method, encoding, requestBody);

    // REQUEST_TIMEOUT: Non-spec timeout from sending request until write stream closed by responder
    await withTimeout(
      async (timeoutAndParentSignal) => await pipe(abortSource(requestSource, timeoutAndParentSignal), stream.sink),
      REQUEST_TIMEOUT,
      signal
    );

    logger.verbose("ReqResp request sent", logCtx);

    // The requester MUST wait a maximum of TTFB_TIMEOUT for the first response byte to arrive

    const responses = await pipe(
      abortSource(stream.source, signal),
      ttfbTimeoutController(TTFB_TIMEOUT, signal),
      responseDecode(config, method, encoding, signal),
      collectResponses(method, maxResponses)
    );

    logger.verbose("ReqResp received response", {...logCtx, responses, chunks: responses.length});

    return responses as T;
  } catch (e) {
    // TODO: Should it be logged here?
    logger.verbose("ReqResp error", logCtx, e);
    throw e;
  } finally {
    stream.close();
  }
}

export function collectResponses<T extends ResponseBody | ResponseBody[]>(
  method: Method,
  maxResponses?: number
): (source: AsyncIterable<ResponseBody>) => Promise<T | null> {
  return async (source) => {
    if (isRequestOnly(method)) {
      // Immediatelly exhaust source if any
      // TODO: use `await source.return()`
      for await (const _ of source) {
        return null;
      }
      return null;
    }

    if (isRequestSingleChunk(method)) {
      for await (const response of source) {
        return response as T;
      }
      return null;
    }

    // else: zero or more responses
    const responses: ResponseBody[] = [];
    for await (const response of source) {
      responses.push(response);

      if (maxResponses && responses.length >= maxResponses) {
        break;
      }
    }
    return responses as T;
  };
}
