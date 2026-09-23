import {peerIdFromString} from "@libp2p/peer-id";
import {
  NativeIncomingRequest,
  NativeNetworkApplicationRuntime,
  NativeRequestError,
  NativeRequestOptions,
  NativeResponseChunk,
} from "@chainsafe/lodestar-z/network";
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
import {ServingHandler, getBoundedReqRespHandlers, servingBudget} from "../../reqresp/serving/handler.js";
import {OutgoingRequestArgs} from "../../reqresp/types.js";
import {NativeNetworkError, NativeNetworkErrorCode, isNativeResultAllocationError, nativeInteger} from "./errors.js";
import {NativeProtocol, nativeFork, nativeProtocols} from "./protocols.js";

function requestError(error: unknown): unknown {
  if (!(error instanceof Error) || !("code" in error)) return error;
  const native = error as NativeRequestError;
  if (native.code === "NetworkRequestRejected") {
    if (["too_many_requests", "slots_exhausted", "negotiation_table_full"].includes(native.reason)) {
      return new RequestError({code: RequestErrorCode.REQUEST_SELF_RATE_LIMITED});
    }
    return new RequestError({code: RequestErrorCode.DIAL_ERROR, error});
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
  if (["invalid_response", "too_many_chunks", "unknown_context"].includes(native.reason)) {
    return new RequestError({code: RequestErrorCode.INVALID_RESPONSE_SSZ, errorMessage: native.reason});
  }
  return new RequestError({code: RequestErrorCode.REQUEST_ERROR, error});
}

export function outgoingNativeRequest(
  runtime: Pick<NativeNetworkApplicationRuntime, "request">,
  protocols: ReadonlyMap<string, NativeProtocol>,
  data: OutgoingRequestArgs,
  options: NativeRequestOptions
): AsyncIterableIterator<ResponseIncoming> {
  nativeInteger(data.versions.length, "request versions", 3, 1);
  let selected: NativeProtocol | undefined;
  for (const version of data.versions) {
    nativeInteger(version, "request version", 3, 1);
    selected = protocols.get(`/eth2/beacon_chain/req/${data.method}/${version}/ssz_snappy`);
    if (selected) break;
  }
  if (!selected)
    throw new NativeNetworkError({code: NativeNetworkErrorCode.UNAVAILABLE, resource: `protocol ${data.method}`});
  const protocol = selected;
  let iterator: AsyncIterableIterator<NativeResponseChunk>;
  try {
    iterator = runtime.request(data.peerId, protocol.id, data.requestData, options);
  } catch (error) {
    throw requestError(error);
  }
  const map = async (
    promise: Promise<IteratorResult<NativeResponseChunk>>
  ): Promise<IteratorResult<ResponseIncoming>> => {
    try {
      const result = await promise;
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
      throw requestError(error);
    }
  };
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => map(iterator.next()),
    return: () => map(iterator.return ? iterator.return() : Promise.resolve({done: true, value: undefined})),
    throw: (error?: unknown) => map(iterator.throw ? iterator.throw(error) : Promise.reject(error)),
  };
}

class IncomingRoute {
  handler: ServingHandler | undefined;
  request: NativeIncomingRequest | undefined;
  constructor(request: NativeIncomingRequest) {
    this.request = request;
  }
  clear(): void {
    this.request = undefined;
    const handler = this.handler;
    this.handler = undefined;
    handler?.cancel();
  }
}

async function serve(
  route: IncomingRoute,
  handler: ServingHandler,
  protocol: NativeProtocol,
  config: BeaconConfig,
  maxChunks: number
): Promise<void> {
  try {
    // Reserve retained data before native credit so new requests cannot block existing responses from finishing.
    await handler.prepare();
    for (let chunks = 0; chunks <= maxChunks; chunks++) {
      if (!route.request) return;
      await route.request.ready();
      if (!route.request) return;
      let result: IteratorResult<ResponseOutgoing> | undefined = await handler.next();
      if (!route.request) return;
      if (result.done) {
        await route.request.finish();
        return;
      }
      if (chunks === maxChunks)
        throw new NativeNetworkError({code: NativeNetworkErrorCode.CAPACITY, resource: "response chunks"});
      const {boundary} = result.value;
      const submission = route.request.respond(
        result.value.data,
        protocol.context
          ? {
              fork: nativeFork(boundary.fork),
              digest: config.forkBoundary2ForkDigest(boundary),
            }
          : null
      );
      result = undefined;
      await submission;
    }
  } catch (error) {
    if (route.request) {
      const status = error instanceof ResponseError ? error.status : RespStatus.SERVER_ERROR;
      const message = error instanceof ResponseError ? error.errorMessage : "Local serving failure";
      await route.request.fail(status, new TextEncoder().encode(message.slice(0, 256)).subarray(0, 256));
    }
  } finally {
    route.clear();
  }
}

export class NativeRequests {
  private readonly routes = new Set<IncomingRoute>();
  private readonly protocols: ReadonlyMap<string, NativeProtocol>;
  private readonly maxChunks: number;
  private closed = false;
  private readonly capacity: number;
  private readonly budget;
  private retry: NodeJS.Timeout | undefined;
  constructor(
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "takeIncomingRequest">,
    private readonly config: BeaconConfig,
    private readonly getHandler: ReturnType<typeof getBoundedReqRespHandlers>,
    capacity: number,
    private readonly onFailure: (error: unknown) => void
  ) {
    nativeInteger(capacity, "incoming route capacity", 32, 1);
    this.budget = servingBudget(getHandler);
    this.capacity = Math.min(capacity, this.budget.snapshot().limits.capacity);
    this.protocols = nativeProtocols(config, config.getForkName(0));
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
  drain(max: number): boolean {
    nativeInteger(max, "incoming drain", 32, 1);
    if (this.closed) return false;
    for (let count = 0; count < max; count++) {
      if (this.routes.size >= this.capacity) return false;
      if (!this.budget.canAcquire()) {
        if (!this.retry) {
          this.retry = setTimeout(() => {
            this.retry = undefined;
            this.drain(this.capacity);
          }, 25);
          this.retry.unref();
        }
        return false;
      }
      let request: NativeIncomingRequest | null;
      try {
        request = this.runtime.takeIncomingRequest();
      } catch (error) {
        if (isNativeResultAllocationError(error)) continue;
        this.onFailure(error);
        return false;
      }
      if (!request) return false;
      const protocol = this.protocols.get(request.protocol);
      if (!protocol) {
        void request
          .fail(RespStatus.SERVER_ERROR, new TextEncoder().encode("Local serving capacity exhausted"))
          .catch(() => {});
        continue;
      }
      const route = new IncomingRoute(request);
      this.routes.add(route);
      void request.closed.then(() => {
        route.clear();
      });
      try {
        const handler = this.getHandler(protocol.method)(
          {data: request.data, version: protocol.version},
          peerIdFromString(request.peerId),
          "unknown"
        );
        route.handler = handler;
        request.retainUntil(handler.retired);
        void handler.retired.then(() => {
          this.routes.delete(route);
          this.drain(this.capacity);
        });
        void serve(route, handler, protocol, this.config, this.maxChunks).catch(() => {});
      } catch (error) {
        const status = error instanceof ResponseError ? error.status : RespStatus.SERVER_ERROR;
        const message = error instanceof ResponseError ? error.errorMessage : "Local serving failure";
        void request.fail(status, new TextEncoder().encode(message.slice(0, 256)).subarray(0, 256)).catch(() => {});
        route.clear();
        void request.closed.then(() => {
          this.routes.delete(route);
          this.drain(this.capacity);
        });
      }
    }
    return true;
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    for (const route of this.routes) {
      const request = route.request;
      route.clear();
      void request?.cancel().catch(() => {});
    }
    this.routes.clear();
  }
}
