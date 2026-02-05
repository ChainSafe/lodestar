import {PeerId} from "@libp2p/interface";
import {byteStream} from "@libp2p/utils";
import type {Libp2p} from "libp2p";
import {ErrorAborted, Logger, TimeoutError, withTimeout} from "@lodestar/utils";
import {encodeRequest} from "../encoders/requestEncode.js";
import {decodeResponse} from "../encoders/responseDecode.js";
import {Metrics} from "../metrics.js";
import {ResponseError} from "../response/index.js";
import {MixedProtocol, ResponseIncoming} from "../types.js";
import {prettyPrintPeerId} from "../utils/index.js";
import {RequestError, RequestErrorCode, responseStatusErrorToRequestError} from "./errors.js";

export {RequestError, RequestErrorCode};

// Default spec values from https://github.com/ethereum/consensus-specs/blob/v1.2.0/specs/phase0/p2p-interface.md#configuration
export const DEFAULT_DIAL_TIMEOUT = 5 * 1000; // 5 sec
export const DEFAULT_REQUEST_TIMEOUT = 5 * 1000; // 5 sec
// Note: TTFB tracking removed per spec relaxation - using single timeout instead
export const DEFAULT_RESP_TIMEOUT = 10 * 1000; // 10 sec

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
 * Sends ReqResp request to a peer using libp2p v3 stream API.
 * Uses byteStream() for imperative read/write operations.
 *
 * 1. Dial peer, establish duplex stream
 * 2. Encode and write request to peer using byteStream().write()
 * 3. Read and decode response(s) from peer using byteStream().read()
 *    - An error result throws ResponseError
 *    - Returns decoded response chunks
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
    // the picked protocol in `stream.protocol`
    const protocolsMap = new Map<string, MixedProtocol>(protocols.map((protocol, i) => [protocolIDs[i], protocol]));

    // DIAL_TIMEOUT: Non-spec timeout from dialing protocol until stream opened
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

    const timerTTFB = metrics?.outgoingResponseTTFB.startTimer({method});

    // Parse protocol selected by the responder
    const protocolId = stream.protocol ?? "unknown";
    const protocol = protocolsMap.get(protocolId);
    if (!protocol) throw Error(`dialProtocol selected unknown protocolId ${protocolId}`);

    // Override with actual version that was negotiated
    logCtx.version = protocol.version;

    logger.debug("Req  sending request", logCtx);

    // Use byteStream for imperative read/write with libp2p v3
    const bytes = byteStream(stream);

    try {
      // Encode request: <varint-length> | <snappy-frames(ssz-payload)>
      const encodedRequest = encodeRequest(protocol, requestBody);

      // Write request with timeout
      // Spec: The requester MUST close the write side of the stream once it finishes writing the request message
      await withTimeout(
        async () => {
          await bytes.write(encodedRequest, {signal});
        },
        REQUEST_TIMEOUT,
        signal
      ).catch((e) => {
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

      // Read and decode responses with timeout
      // Single timeout for entire response per spec relaxation (no separate TTFB)
      let firstResponse = true;
      const responseTimeoutSignal = AbortSignal.timeout(RESP_TIMEOUT);

      // Combine parent signal with response timeout
      const combinedSignal = signal ? AbortSignal.any([signal, responseTimeoutSignal]) : responseTimeoutSignal;

      try {
        // Read responses using decodeResponse generator
        for await (const response of decodeResponse(bytes, protocol, combinedSignal)) {
          if (firstResponse) {
            timerTTFB?.();
            firstResponse = false;
          }
          yield response;
        }
      } catch (e) {
        // Convert TimeoutError from AbortSignal.timeout to RequestError
        if (e instanceof TimeoutError || (e instanceof Error && e.name === "TimeoutError")) {
          throw new RequestError({code: RequestErrorCode.RESP_TIMEOUT});
        }
        throw e;
      }

      logger.verbose("Req  done", logCtx);
    } finally {
      // Ensure stream is properly closed
      await stream.close();
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
