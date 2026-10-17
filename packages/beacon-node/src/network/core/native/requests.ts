import {peerIdFromString} from "@libp2p/peer-id";
import {
  IncomingRequest,
  NativeNetwork,
  NativePeerOrigin,
  NativeRequestError,
  NativeResponseChunk,
} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {
  RequestError,
  RequestErrorCode,
  RespStatus,
  ResponseError,
  ResponseOutgoing,
  RpcResponseStatusError,
  responseStatusErrorToRequestError,
} from "@lodestar/reqresp";
import {Logger, isErrorAborted} from "@lodestar/utils";
import {PeerAction} from "../../peers/score/index.js";
import {onOutgoingReqRespError} from "../../reqresp/score.js";
import {GetReqRespHandlerFn, OutgoingRequestArgs, ResponseIncoming} from "../../reqresp/types.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";
import {NativeProtocol, nativeFork, nativeProtocols} from "./protocols.js";

function requestError(error: unknown): unknown {
  if (!(error instanceof Error) || !("code" in error)) return error;
  const native = error as NativeRequestError;
  if (native.code === "NetworkRequestRejected") {
    if (["too_many_requests", "slots_exhausted", "negotiation_table_full"].includes(native.reason)) {
      return new RequestError({code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED});
    }
    return new RequestError({code: RequestErrorCode.REQUEST_ERROR, error});
  }
  if (native.code !== "NetworkRequestFailed") return error;
  if (native.reason === "peer_error" && native.peerStatus !== null) {
    return new RequestError(
      responseStatusErrorToRequestError(
        new ResponseError(
          native.peerStatus as RpcResponseStatusError,
          new TextDecoder().decode(native.peerMessage ?? new Uint8Array())
        )
      )
    );
  }
  if (native.reason === "negotiation_failed" && native.detail === "timeout") {
    return new RequestError({code: RequestErrorCode.DIAL_TIMEOUT});
  }
  if (native.reason === "negotiation_rejected" || native.reason === "negotiation_failed") {
    return new RequestError({
      code: RequestErrorCode.DIAL_ERROR,
      error: native.reason === "negotiation_rejected" ? new Error("protocol selection failed") : error,
    });
  }
  if (native.reason === "timeout") {
    return new RequestError({
      code:
        native.phase === "negotiation"
          ? RequestErrorCode.DIAL_TIMEOUT
          : native.phase === "request"
            ? RequestErrorCode.REQUEST_TIMEOUT
            : RequestErrorCode.RESP_TIMEOUT,
    });
  }
  if (native.reason === "empty_response") {
    return new RequestError({code: RequestErrorCode.EMPTY_RESPONSE});
  }
  if (["invalid_response", "too_many_chunks", "unknown_context"].includes(native.reason)) {
    return new RequestError({code: RequestErrorCode.INVALID_RESPONSE_SSZ, errorMessage: native.reason});
  }
  return new RequestError({code: RequestErrorCode.REQUEST_ERROR, error});
}

export function outgoingNativeRequest(
  network: Pick<NativeNetwork, "request">,
  data: OutgoingRequestArgs,
  report: (action: PeerAction, reason: string, origin?: NativePeerOrigin) => void
): AsyncIterableIterator<ResponseIncoming> {
  nativeInteger(data.versions.length, "request versions", 3, 1);
  let selected: NativeProtocol | undefined;
  for (const version of data.versions) {
    nativeInteger(version, "request version", 3, 1);
    selected = nativeProtocols.get(`/eth2/beacon_chain/req/${data.method}/${version}/ssz_snappy`);
    if (selected) break;
  }
  if (!selected)
    throw new NativeNetworkError({code: NativeNetworkErrorCode.UNAVAILABLE, resource: `protocol ${data.method}`});
  const protocol = selected;
  let iterator: AsyncIterableIterator<NativeResponseChunk>;
  try {
    iterator = network.request(data.peerId, protocol.id, data.requestData);
  } catch (error) {
    throw requestError(error);
  }
  let reported = false;
  const map = async (
    operation: () => Promise<IteratorResult<NativeResponseChunk>>,
    score = false
  ): Promise<IteratorResult<ResponseIncoming>> => {
    try {
      const result = await operation();
      if (result.done) return {done: true, value: undefined};
      if (result.value.protocol !== protocol.id)
        throw new NativeNetworkError({
          code: NativeNetworkErrorCode.CONFIGURATION,
          resource: "response protocol invariant",
        });
      return {
        done: false,
        value: {
          data: result.value.data,
          fork: ForkName[result.value.fork ?? "phase0"],
          protocolVersion: protocol.version,
          peerReportContext: {origin: result.value.origin, reason: "reqresp_response"},
        },
      };
    } catch (error) {
      const mapped = requestError(error);
      const nativeFault = error instanceof Error && "peerFault" in error && error.peerFault !== null;
      if (score && !reported && !nativeFault && mapped instanceof RequestError) {
        reported = true;
        // Native owns framing and response-timeout attribution. A null fault can mean a local limit or delay.
        const action =
          mapped.type.code === RequestErrorCode.RESP_TIMEOUT ||
          mapped.type.code === RequestErrorCode.INVALID_RESPONSE_SSZ
            ? null
            : onOutgoingReqRespError(mapped, data.method);
        if (action !== null) {
          const native = error as NativeRequestError;
          const origin = native.code === "NetworkRequestFailed" ? native.origin : null;
          if (origin) report(action, mapped.type.code, origin);
          else report(action, mapped.type.code);
        }
      }
      throw mapped;
    }
  };
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => map(() => iterator.next(), true),
    return: () => map(() => (iterator.return ? iterator.return() : Promise.resolve({done: true, value: undefined}))),
    throw: (error?: unknown) => map(() => (iterator.throw ? iterator.throw(error) : Promise.reject(error))),
  };
}

function fail(request: IncomingRequest, error: unknown, logger: Logger): Promise<void> {
  const status = error instanceof ResponseError ? error.status : RespStatus.SERVER_ERROR;
  const message = error instanceof ResponseError ? error.errorMessage : "Local serving failure";
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (
    status === RespStatus.SERVER_ERROR &&
    !isErrorAborted(error) &&
    code !== "NetworkClosed" &&
    code !== "NetworkIncomingClosed" &&
    code !== "NetworkIncomingFailed"
  ) {
    logger.error("Native request serving failed", {protocol: request.protocol, peer: request.peerId}, error as Error);
  }
  return request.fail(status, new TextEncoder().encode(message.slice(0, 256)).subarray(0, 256)).catch(() => {});
}

/** Keeps the native serving lease until the pending pull and iterator cleanup have settled. */
export async function serveNativeRequest(
  request: IncomingRequest,
  getHandler: GetReqRespHandlerFn,
  config: BeaconConfig,
  logger: Logger
): Promise<void> {
  const protocol = nativeProtocols.get(request.protocol);
  if (!protocol)
    return fail(request, new ResponseError(RespStatus.SERVER_ERROR, "Unsupported serving protocol"), logger);
  let closed = false;
  void request.closed.then(() => {
    closed = true;
  });
  try {
    await request.ready();
    if (closed) return;
    const handler = getHandler(protocol.method)(
      {data: request.data, version: protocol.version},
      peerIdFromString(request.peerId),
      "unknown"
    )[Symbol.asyncIterator]();
    try {
      while (!closed) {
        let result: IteratorResult<ResponseOutgoing> | undefined = await handler.next();
        if (closed) return;
        if (result.done) return await request.finish();
        const {boundary} = result.value;
        const submission = request.respond(result.value.data, {
          fork: nativeFork(boundary.fork),
          digest: config.forkBoundary2ForkDigest(boundary),
        });
        result = undefined;
        await submission;
      }
    } finally {
      await handler.return?.();
    }
  } catch (error) {
    await fail(request, error, logger);
  }
}
