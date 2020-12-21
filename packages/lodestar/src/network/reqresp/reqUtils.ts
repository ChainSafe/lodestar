import {IBeaconSSZTypes, RequestBody, RequestId, ResponseBody} from "@chainsafe/lodestar-types";
import {Type} from "@chainsafe/ssz";
import {AbortController, AbortSignal} from "abort-controller";
import {source as abortSource} from "abortable-iterator";
import all from "it-all";
import pipe from "it-pipe";
import PeerId from "peer-id";
import {
  createRpcProtocol,
  dialProtocolWithTimeout,
  timeToFirstByteTimeout,
  isRequestOnly,
  isRequestSingleChunk,
  randomRequestId,
} from "..";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ErrorAborted, ILogger} from "@chainsafe/lodestar-utils";
import {Method, MethodRequestType, ReqRespEncoding, TTFB_TIMEOUT, REQUEST_TIMEOUT} from "../../constants";
import {requestEncode, requestEncodeOne} from "./encoders/requestEncode";
import {responseDecode} from "./encoders/responseDecode";
import {REQUEST_TIMEOUT_ERR} from "../error";

export async function sendRequest<T extends ResponseBody | ResponseBody[]>(
  modules: {libp2p: LibP2p; config: IBeaconConfig; logger: ILogger},
  peerId: PeerId,
  method: Method,
  encoding: ReqRespEncoding,
  body: RequestBody,
  signal?: AbortSignal
): Promise<T | null> {
  if (signal?.aborted) {
    throw new ErrorAborted("sendRequest");
  }

  const requestOnly = isRequestOnly(method);
  const requestSingleChunk = isRequestSingleChunk(method);
  const requestId = randomRequestId();

  try {
    return await pipe(
      sendRequestStream(modules, peerId, method, encoding, requestId, body, signal),
      handleResponses<T>(modules, peerId, method, encoding, requestId, requestSingleChunk, requestOnly, body)
    );
  } catch (e) {
    modules.logger.warn("failed to send request", {requestId, peerId: peerId.toB58String(), method}, e);
    throw e;
  }
}

export async function* sendRequestStream(
  modules: {libp2p: LibP2p; config: IBeaconConfig; logger: ILogger},
  peerId: PeerId,
  method: Method,
  encoding: ReqRespEncoding,
  requestId: RequestId,
  requestBody: RequestBody,
  signal?: AbortSignal
): AsyncIterable<ResponseBody> {
  const {libp2p, config, logger} = modules;

  logger.verbose("sending request to peer", {peer: peerId.toB58String(), method, requestId, encoding});

  const controller = new AbortController();

  const protocol = createRpcProtocol(method, encoding);
  const connection = await dialProtocolWithTimeout(libp2p, peerId, protocol, TTFB_TIMEOUT, signal).catch((e) => {
    throw new Error("Failed to dial peer " + peerId.toB58String() + " (" + e.message + ") protocol: " + protocol);
  });

  // Re-declare to properly type
  const streamSource = connection.stream.source as AsyncIterable<Buffer>;
  const streamSink = connection.stream.sink as (source: AsyncIterable<Buffer>) => Promise<void>;

  // Send request with non-speced REQ_TIMEOUT
  // The requester MUST close the write side of the stream once it finishes writing the request message

  try {
    // Additional non-spec request timeout
    await withTimeout(() => {
      const requestSource = requestEncodeOne(config, method, encoding, requestBody);
      // Sink should be closed automatically by js-libp2p-mplex when piped source ends
      await streamSink(requestSource);
    }, REQUEST_TIMEOUT);

    logger.verbose("sent request", {peer: peerId.toB58String(), method});

    // The requester MUST wait a maximum of TTFB_TIMEOUT for the first response byte to arrive

    yield* pipe(
      abortSource(streamSource, controller.signal, {returnOnAbort: true}),
      timeToFirstByteTimeout(controller),
      responseDecode(config, logger, method, encoding, requestId, controller)
    );
  } catch (e) {
    // # TODO: Should it be logged here?
    logger.verbose("sent request", {peer: peerId.toB58String(), method});
    throw e;
  } finally {
    connection.stream.close();
  }
}

export function handleResponses<T extends ResponseBody | ResponseBody[]>(
  modules: {config: IBeaconConfig; logger: ILogger},
  peerId: PeerId,
  method: Method,
  encoding: ReqRespEncoding,
  requestId: RequestId,
  requestSingleChunk: boolean,
  requestOnly: boolean,
  body?: RequestBody
): (source: AsyncIterable<T>) => Promise<T | null> {
  return async (source) => {
    const {logger, config} = modules;
    const responses = await all(source);
    if (requestSingleChunk && responses.length === 0) {
      // allow empty response for beacon blocks by range/root
      logger.verbose("No response returned", {method, requestId, peer: peerId.toB58String()});
      return null;
    }

    const finalResponse = requestSingleChunk ? responses[0] : responses;
    logger.verbose("received response chunks", {
      peer: peerId.toB58String(),
      method,
      chunks: responses.length,
      requestId,
      encoding,
      body:
        body != null &&
        (config.types[MethodRequestType[method] as keyof IBeaconSSZTypes] as Type<unknown>).toJson(body),
    });

    return requestOnly ? null : (finalResponse as T);
  };
}
