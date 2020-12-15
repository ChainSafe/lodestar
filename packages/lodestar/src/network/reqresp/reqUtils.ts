import {IBeaconSSZTypes, RequestBody, RequestId, ResponseBody} from "@chainsafe/lodestar-types";
import {Type} from "@chainsafe/ssz";
import AbortController, {AbortSignal} from "abort-controller";
import {duplex as abortDuplex} from "abortable-iterator";
import all from "it-all";
import pipe from "it-pipe";
import PeerId from "peer-id";
import {
  createRpcProtocol,
  dialProtocol,
  eth2ResponseTimer,
  isRequestOnly,
  isRequestSingleChunk,
  randomRequestId,
} from "..";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ErrorAborted, ILogger} from "@chainsafe/lodestar-utils";
import {Method, MethodRequestType, ReqRespEncoding, TTFB_TIMEOUT, REQUEST_TIMEOUT} from "../../constants";
import {streamRequestBodyTo} from "../encoders/request";
import {eth2ResponseDecode} from "../encoders/response";
import {REQUEST_TIMEOUT_ERR} from "../error";

export async function sendRequest<T extends ResponseBody | ResponseBody[]>(
  modules: {libp2p: LibP2p; config: IBeaconConfig; logger: ILogger},
  peerId: PeerId,
  method: Method,
  encoding: ReqRespEncoding,
  body?: RequestBody,
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

export async function* sendRequestStream<T extends ResponseBody>(
  modules: {libp2p: LibP2p; config: IBeaconConfig; logger: ILogger},
  peerId: PeerId,
  method: Method,
  encoding: ReqRespEncoding,
  requestId: RequestId,
  requestBody?: RequestBody,
  signal?: AbortSignal
): AsyncIterable<T> {
  const {libp2p, config, logger} = modules;

  const protocol = createRpcProtocol(method, encoding);
  logger.verbose("sending request to peer", {peer: peerId.toB58String(), method, requestId, encoding});
  let conn: {stream: Stream} | undefined;
  const controller = new AbortController();
  let requestTimer: NodeJS.Timeout | null = null;

  // write
  try {
    await Promise.race([
      (async function () {
        try {
          conn = (await dialProtocol(libp2p, peerId, protocol, TTFB_TIMEOUT, signal)) as {stream: Stream};
        } catch (e) {
          throw new Error("Failed to dial peer " + peerId.toB58String() + " (" + e.message + ") protocol: " + protocol);
        }
        logger.verbose("got stream to peer", {peer: peerId.toB58String(), requestId, encoding});

        if (requestBody) {
          await streamRequestBodyTo(config, method, encoding, requestBody, conn.stream);
        }
      })(),
      new Promise((_, reject) => {
        requestTimer = setTimeout(() => {
          reject(new Error(REQUEST_TIMEOUT_ERR));
        }, REQUEST_TIMEOUT);
      }),
    ]);
  } catch (e) {
    conn?.stream?.close();
    throw e;
  }

  if (requestTimer) clearTimeout(requestTimer);
  logger.verbose("sent request", {peer: peerId.toB58String(), method});

  yield* pipe(
    abortDuplex(conn!.stream, controller.signal, {returnOnAbort: true}),
    eth2ResponseTimer(controller),
    eth2ResponseDecode(config, logger, method, encoding, requestId, controller)
  );
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
