import {AbortSignal} from "abort-controller";
import {source as abortSource} from "abortable-iterator";
import pipe from "it-pipe";
import PeerId from "peer-id";
import {RequestBody, ResponseBody} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ErrorAborted, ILogger, Context, withTimeout} from "@chainsafe/lodestar-utils";
import {Method, ReqRespEncoding, TTFB_TIMEOUT, REQUEST_TIMEOUT, DIAL_TIMEOUT} from "../../../constants";
import {createRpcProtocol, randomRequestId} from "../../util";
import {ResponseError, ResponseErrorCode, ResponseInternalError} from "./errors";
import {ttfbTimeoutController} from "./ttfbTimeoutController";
import {collectResponses} from "./collectResponses";
import {requestEncode} from "./requestEncode";
import {responseDecode} from "./responseDecode";
import {ILibP2pStream} from "../interface";

export {ResponseError, ResponseErrorCode};

// A requester SHOULD read from the stream until either:
// 1. An error result is received in one of the chunks (the error payload MAY be read before stopping).
// 2. The responder closes the stream.
// 3. Any part of the response_chunk fails validation.
// 4. The maximum number of requested chunks are read.

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

  logger.verbose("ReqResp sending request", {...logCtx, requestBody} as Context);

  // Send request with non-speced REQ_TIMEOUT
  // The requester MUST close the write side of the stream once it finishes writing the request message
  // stream.sink should be closed automatically by js-libp2p-mplex when piped source ends

  try {
    // REQUEST_TIMEOUT: Non-spec timeout from sending request until write stream closed by responder
    await withTimeout(
      async (timeoutAndParentSignal) =>
        await pipe(
          abortSource(requestEncode(config, method, encoding, requestBody), timeoutAndParentSignal),
          stream.sink
        ),
      REQUEST_TIMEOUT,
      signal
    );

    logger.verbose("ReqResp request sent", logCtx);

    const responses = await pipe(
      abortSource(stream.source, signal),
      // The requester MUST wait a maximum of TTFB_TIMEOUT for the first response byte to arrive
      ttfbTimeoutController(TTFB_TIMEOUT, signal),
      responseDecode(config, method, encoding, signal),
      collectResponses(method, maxResponses)
    );

    logger.verbose("ReqResp received response", {...logCtx, responses} as Context);

    return responses as T;
  } catch (e) {
    logger.verbose("ReqResp error", logCtx, e);

    if (e instanceof ResponseInternalError) {
      throw new ResponseError({...e.type, method, encoding});
    } else {
      throw e;
    }
  } finally {
    stream.close();
  }
}
