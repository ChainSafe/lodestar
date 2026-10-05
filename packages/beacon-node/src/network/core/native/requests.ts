import {peerIdFromString} from "@libp2p/peer-id";
import {IncomingRequest, NativeNetwork, NativeRequestError, NativeResponseChunk} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {
  RequestError,
  RequestErrorCode,
  RespStatus,
  ResponseError,
  ResponseIncoming,
  ResponseOutgoing,
  RpcResponseStatusError,
  responseStatusErrorToRequestError,
} from "@lodestar/reqresp";
import {PeerAction} from "../../peers/score/index.js";
import {onOutgoingReqRespError} from "../../reqresp/score.js";
import {BoundedServing, LocalServingResponseError, ServingHandler} from "../../reqresp/serving/handler.js";
import {OutgoingRequestArgs} from "../../reqresp/types.js";
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
  report: (action: PeerAction, reason: string) => void
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
        },
      };
    } catch (error) {
      const mapped = requestError(error);
      if (score && !reported && mapped instanceof RequestError) {
        reported = true;
        const action = onOutgoingReqRespError(mapped, data.method);
        if (action !== null) report(action, mapped.type.code);
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

function fail(request: IncomingRequest, error: unknown): Promise<void> {
  const status = error instanceof ResponseError ? error.status : RespStatus.SERVER_ERROR;
  const message = error instanceof ResponseError ? error.errorMessage : "Local serving failure";
  return request.fail(status, new TextEncoder().encode(message.slice(0, 256)).subarray(0, 256)).catch(() => {});
}

async function respond(
  request: IncomingRequest,
  handler: ServingHandler,
  config: BeaconConfig,
  maxChunks: number
): Promise<void> {
  // Reserve retained data before native credit so new requests cannot block existing responses from finishing.
  await handler.prepare();
  for (let chunks = 0; chunks <= maxChunks; chunks++) {
    await request.ready();
    let result: IteratorResult<ResponseOutgoing> | undefined = await handler.next();
    if (result.done) return request.finish();
    if (chunks === maxChunks)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CAPACITY, resource: "response chunks"});
    const {boundary} = result.value;
    const submission = request.respond(result.value.data, {
      fork: nativeFork(boundary.fork),
      digest: config.forkBoundary2ForkDigest(boundary),
    });
    result = undefined;
    await submission;
  }
}

const RESERVED_NAME = "lodestar_native_host_serving_reserved_bytes";
const PENDING_NAME = "lodestar_native_host_serving_source_pending_bytes";

export class NativeRequests {
  /** Each request's handler until it retires, with the stream it answers. */
  private readonly serving = new Map<ServingHandler, IncomingRequest>();
  private readonly maxChunks: number;
  private closed = false;
  /** Requests served at once. */
  private readonly limit: number;
  private readonly budget;
  private readonly getHandler;
  constructor(
    private readonly config: BeaconConfig,
    serving: BoundedServing,
    capacity: number
  ) {
    nativeInteger(capacity, "incoming route capacity", 32, 1);
    this.budget = serving.budget;
    this.getHandler = serving.getHandler;
    this.limit = Math.min(capacity, this.budget.snapshot().limits.capacity);
    this.maxChunks = nativeInteger(
      Math.max(
        config.MAX_REQUEST_BLOCKS,
        config.MAX_REQUEST_BLOCKS_DENEB,
        config.MAX_REQUEST_BLOB_SIDECARS,
        config.MAX_REQUEST_BLOB_SIDECARS_ELECTRA,
        config.MAX_REQUEST_DATA_COLUMN_SIDECARS,
        MAX_REQUEST_LIGHT_CLIENT_UPDATES
      ),
      "response chunk limit",
      65536,
      1
    );
  }
  /**
   * Serving starts the host can take now: free routes and the host serving budget, which other adapters share, bound
   * them. A request charges a route until its handler retires.
   */
  capacity(): number {
    return Math.max(0, Math.min(this.limit - this.serving.size, this.budget.remaining()));
  }
  /**
   * Serves one request, cancelling its handler when the stream closes. Settles once the handler retired, including
   * work that outlived the stream.
   */
  async serve(request: IncomingRequest): Promise<void> {
    if (this.closed) return request.cancel();
    const protocol = nativeProtocols.get(request.protocol);
    if (!protocol) return fail(request, new LocalServingResponseError());
    let handler: ServingHandler;
    try {
      handler = this.getHandler(protocol.method)(
        {data: request.data, version: protocol.version},
        peerIdFromString(request.peerId),
        "unknown"
      );
    } catch (error) {
      return fail(request, error);
    }
    this.serving.set(handler, request);
    void request.closed.then(() => handler.cancel());
    try {
      await respond(request, handler, this.config, this.maxChunks);
    } catch (error) {
      await fail(request, error);
    } finally {
      handler.cancel();
      await handler.retired;
      this.serving.delete(handler);
    }
  }
  /** The environment's serving reservations, retiring leases of earlier adapters included, in exposition format. */
  metrics(): string {
    const {reservedBytes, reservedSourceBytes, pendingSourceLimitBytes} = this.budget.snapshot();
    return [
      `# HELP ${RESERVED_NAME} Host serving allowance still charged, retiring leases included: every reservation (total) or the retained-response and production part (source). Reservations, not allocated memory; source is part of total, so do not sum the scopes`,
      `# TYPE ${RESERVED_NAME} gauge`,
      `${RESERVED_NAME}{scope="total"} ${reservedBytes}`,
      `${RESERVED_NAME}{scope="source"} ${reservedSourceBytes}`,
      `# HELP ${PENDING_NAME} Source-read reservations of bounded serving reads still outstanding, retiring leases included. Reservations, not allocated memory`,
      `# TYPE ${PENDING_NAME} gauge`,
      `${PENDING_NAME} ${pendingSourceLimitBytes}`,
      "",
    ].join("\n");
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [handler, request] of this.serving) {
      handler.cancel();
      void request.cancel().catch(() => {});
    }
  }
}
