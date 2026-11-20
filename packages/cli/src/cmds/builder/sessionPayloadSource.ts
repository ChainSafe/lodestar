import {createHash} from "node:crypto";
import {RLP} from "@ethereumjs/rlp";
import {
  type EngineApiRpcReturnTypes,
  ErrorJsonRpcResponse,
  type JsonRpcHttpClient,
  parseExecutionPayload,
  serializePayloadAttributes,
} from "@lodestar/beacon-node";
import {
  type BuildHandle,
  type BuildRequest,
  type BuiltPayload,
  type OfferLease,
  type OrderMetadata,
  type PayloadSource,
  PayloadSourceNotReady,
  type PayloadSourceResources,
  type RetainedOffer,
  isAlternateBuild,
  isOrderOfferAllowed,
  parseOrderMetadata,
  sameOrderMetadata,
} from "@lodestar/builder";
import {CELLS_PER_EXT_BLOB, FIELD_ELEMENTS_PER_BLOB, ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {ErrorAborted, LodestarError, type Logger, isFetchError, sleep, toHex, withTimeout} from "@lodestar/utils";

type Rpc = Pick<JsonRpcHttpClient, "fetch">;
type PayloadResponse = EngineApiRpcReturnTypes["engine_getPayloadV6"];
type RetainedResponse = {
  orderMetadata?: unknown;
  retainedOfferVersion: number;
  offerId: string;
  namespace: string;
  generation: string;
  currentGeneration: string;
  leaseMs: number;
  ready: boolean;
  parentHash: string;
  parentBeaconBlockRoot: string;
  blockHash: string;
  slot: string;
  payload: PayloadResponse;
};
type RetainedLeaseResponse = Omit<RetainedResponse, "payload">;
type LeasedResponse = {
  orderMetadata?: unknown;
  generation: string;
  namespace?: string | null;
  leaseMs: number;
  ready: boolean;
  payload: PayloadResponse | null;
};
// Native operations allow up to 15s; retain the reply through bounded failure
// cleanup too. The orchestrator's build deadline still detaches independently.
const BEGIN_RPC_TIMEOUT_MS = 20_000;
const CONSTRUCTOR_CAPACITY = 2;
const BEGIN_REJECTION_LOG_INTERVAL_MS = 1000;
const BEGIN_RETRY_MAX_MS = 1000;
const BEGIN_REJECTIONS = [
  "SlotNotArmed",
  "ConstructionHalted",
  "SessionLimit",
  "AlternateSessionLimit",
  "UnknownSession",
  "BeginReservationInstanceMismatch",
  "BeginReservationClaimed",
  "UnknownBeginReservation",
  "BeginReservationCancelled",
  "BeginReservationLimit",
  "BeginReservationExhausted",
  "AlternateLeasesUnsupported",
  "MethodNotSupported",
  "UnknownMethod",
  "MethodNotFound",
  "InvalidParameters",
] as const;
type BeginRejection = (typeof BEGIN_REJECTIONS)[number] | "OtherJsonRpcRejection";

export enum SessionPayloadErrorCode {
  INVALID_SESSION = "SESSION_PAYLOAD_INVALID_SESSION",
  UNKNOWN_HANDLE = "SESSION_PAYLOAD_UNKNOWN_HANDLE",
  RESPONSE_MISMATCH = "SESSION_PAYLOAD_RESPONSE_MISMATCH",
  UNSUPPORTED_FORK = "SESSION_PAYLOAD_UNSUPPORTED_FORK",
  ALTERNATE_UNSUPPORTED = "SESSION_PAYLOAD_ALTERNATE_UNSUPPORTED",
  CAPACITY = "SESSION_PAYLOAD_CAPACITY",
  RELEASE_UNCONFIRMED = "SESSION_PAYLOAD_RELEASE_UNCONFIRMED",
}

export class SessionPayloadError extends LodestarError<{code: SessionPayloadErrorCode; reason: string}> {}

type SessionEntry = {
  request: BuildRequest;
  latest?: BuiltPayload;
  lease?: OfferLease;
  state: "active" | "releasing" | "uncertain";
  release?: Promise<void>;
  reserved?: boolean;
  reconcileAfter?: number;
  reconcileFailures?: number;
  beginRejected?: boolean;
  primaryHandoff?: boolean;
  handoffRequested?: boolean;
};

type Reconciliation = {
  signal: AbortSignal;
  attempted: Set<string>;
  releases: Promise<PromiseSettledResult<void>>[];
  promise: Promise<void>;
  accepting: boolean;
};

type AlternateDisabledReason =
  | "ambiguous_begin"
  | "invalid_begin_handle"
  | "unsupported_alternate_method"
  | "unconfirmed_alternate_capability";

/** Private constructor RPC; the constructor validates seals before publishing a ready snapshot. */
export class SessionPayloadSource implements PayloadSource {
  readonly supportsUpdates = true;
  private readonly requests = new Map<string, SessionEntry>();
  private preparing = 0;
  private retainedProtocol = false;
  private primaryHandoffProtocol = false;
  private orphaned = 0;
  private alternatesDisabled = false;
  private reconciliation: Reconciliation | undefined;
  private beginRetry = {slot: -1, failures: 0, after: 0};
  private readonly beginRejectionWarnings = new Map<BeginRejection, number>();

  constructor(
    readonly id: string,
    private readonly rpc: (signal: AbortSignal) => Rpc,
    private readonly options: {
      boundedAlternates?: boolean;
      beginReservations?: boolean;
      retainedAlternateOffers?: boolean;
      primaryHandoff?: boolean;
      logger?: {warn: Logger["warn"]};
    } = {}
  ) {}

  get supportsBoundedAlternates(): boolean {
    return this.options.boundedAlternates === true;
  }

  get supportsRetainedOffers(): boolean {
    return this.options.retainedAlternateOffers === true && this.retainedProtocol;
  }

  get supportsPrimaryHandoff(): boolean {
    return this.options.primaryHandoff === true && this.supportsRetainedOffers && this.primaryHandoffProtocol;
  }

  private get tracksSessions(): boolean {
    return this.supportsBoundedAlternates || this.options.beginReservations === true;
  }

  getResources(): PayloadSourceResources | undefined {
    if (!this.tracksSessions) return undefined;
    const result: PayloadSourceResources = {
      capacity: CONSTRUCTOR_CAPACITY,
      preparing: this.preparing,
      active: 0,
      releasing: 0,
      uncertain: this.orphaned,
      alternatesDisabled: this.alternatesDisabled,
    };
    for (const entry of this.requests.values()) result[entry.state]++;
    return result;
  }

  private warnAlternatesDisabled(
    request: BuildRequest,
    signal: AbortSignal,
    reason: AlternateDisabledReason,
    method = request.requireRetainedOffer
      ? "zbuilder_beginAlternateV2"
      : request.requireUnleased
        ? "zbuilder_beginAlternateV1"
        : "zbuilder_beginV1"
  ): void {
    try {
      const logger = this.options.logger;
      if (!logger) return;
      const resources = this.getResources();
      logger.warn("Constructor alternate admission disabled", {
        code: "SESSION_PAYLOAD_ALTERNATES_DISABLED",
        reason,
        method,
        slot: request.payloadAttributes.slotNumber,
        parentBlockHash: request.forkchoiceState.headBlockHash,
        parentBlockRoot: toHex(request.payloadAttributes.parentBeaconBlockRoot),
        callerAborted: signal.aborted,
        orphaned: this.orphaned,
        capacity: resources?.capacity,
        active: resources?.active,
        preparing: resources?.preparing,
        releasing: resources?.releasing,
        uncertain: resources?.uncertain,
        alternatesDisabled: resources?.alternatesDisabled,
      });
    } catch {
      // Diagnostic failures must not change admission or session ownership.
    }
  }

  private noteBeginRejection(
    request: BuildRequest,
    signal: AbortSignal,
    method: string,
    error: unknown,
    ticket?: string
  ): BeginRejection | undefined {
    let reason: BeginRejection | undefined;
    try {
      if (!(error instanceof ErrorJsonRpcResponse)) return undefined;
      const rejection = error.response.error;
      reason =
        rejection.code === -32601
          ? "MethodNotFound"
          : (rejection.code === -32000 && BEGIN_REJECTIONS.find((name) => name === rejection.message)) ||
            "OtherJsonRpcRejection";
      const now = performance.now();
      if (
        !isAlternateBuild(request) &&
        (reason === "SlotNotArmed" || reason === "ConstructionHalted") &&
        this.beginRetry.slot === request.payloadAttributes.slotNumber
      ) {
        this.beginRetry.failures = Math.min(4, this.beginRetry.failures + 1);
        this.beginRetry.after = now + Math.min(BEGIN_RETRY_MAX_MS, 100 * 2 ** this.beginRetry.failures);
      }
      const previous = this.beginRejectionWarnings.get(reason);
      if (previous !== undefined && now - previous < BEGIN_REJECTION_LOG_INTERVAL_MS) return reason;
      this.beginRejectionWarnings.set(reason, now);
      this.options.logger?.warn("Constructor begin rejected", {
        code: "SESSION_PAYLOAD_BEGIN_REJECTED",
        reason,
        method,
        slot: request.payloadAttributes.slotNumber,
        callerAborted: signal.aborted,
        cleanupPending: ticket !== undefined,
        sessionId: ticket,
      });
    } catch {
      // Diagnostics must not change the original error or ticket ownership.
    }
    return reason;
  }

  private resetBeginRetry(request: BuildRequest): void {
    if (this.beginRetry.slot === request.payloadAttributes.slotNumber) {
      this.beginRetry.failures = 0;
      this.beginRetry.after = 0;
    }
  }

  private addReconciliationEntries(pending: Reconciliation): void {
    if (!pending.accepting || pending.signal.aborted) return;
    const now = performance.now();
    for (const [payloadId, entry] of [...this.requests]) {
      if (pending.attempted.size === CONSTRUCTOR_CAPACITY) break;
      if (entry.state !== "uncertain" || (entry.reconcileAfter ?? 0) > now || pending.attempted.has(payloadId))
        continue;
      pending.attempted.add(payloadId);
      pending.releases.push(
        Promise.allSettled([
          this.release({sourceId: this.id, fork: entry.request.fork, payloadId}, pending.signal),
        ]).then(([result]) => result)
      );
    }
  }

  async reconcileResources(signal: AbortSignal): Promise<void> {
    if (!this.tracksSessions) return;
    let pending = this.reconciliation;
    if (pending === undefined || !pending.accepting) {
      const cleanupSignal = AbortSignal.any([signal, AbortSignal.timeout(6000)]);
      pending = {
        signal: cleanupSignal,
        attempted: new Set(),
        releases: [],
        promise: Promise.resolve(),
        accepting: true,
      };
      this.reconciliation = pending;
      this.addReconciliationEntries(pending);
      const current = pending;
      current.promise = (async () => {
        try {
          let completed = 0;
          const failed: PromiseRejectedResult[] = [];
          while (completed < current.releases.length) {
            const releases = current.releases.slice(completed);
            completed += releases.length;
            const results = await Promise.all(releases);
            for (const result of results) if (result.status === "rejected") failed.push(result);
          }
          cleanupSignal.throwIfAborted();
          if (failed.length > 0) throw failed[0].reason;
        } finally {
          current.accepting = false;
        }
      })().finally(() => {
        if (this.reconciliation === current) this.reconciliation = undefined;
      });
    } else {
      this.addReconciliationEntries(pending);
    }
    const current = pending;
    await withTimeout(() => current.promise, 6000, signal);
  }

  async prepare(request: BuildRequest, signal: AbortSignal): Promise<BuildHandle> {
    if (signal.aborted) throw new ErrorAborted();
    if (request.fork !== ForkName.gloas) {
      throw new SessionPayloadError({code: SessionPayloadErrorCode.UNSUPPORTED_FORK, reason: request.fork});
    }
    const bounded = this.tracksSessions;
    const alternate = isAlternateBuild(request);
    if (request.requireRetainedOffer && (request.requireUnleased || !this.supportsRetainedOffers))
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED,
        reason: "Retained alternate offers unavailable",
      });
    if (request.payloadAttributes.slotNumber > this.beginRetry.slot) {
      this.beginRetry = {slot: request.payloadAttributes.slotNumber, failures: 0, after: 0};
    }
    if (alternate && (!this.supportsBoundedAlternates || this.alternatesDisabled))
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED,
        reason: "Alternates unavailable",
      });
    const call = {
      method: request.requireRetainedOffer
        ? "zbuilder_beginAlternateV2"
        : alternate
          ? "zbuilder_beginAlternateV1"
          : "zbuilder_beginV1",
      params: [request.forkchoiceState.headBlockHash, serializePayloadAttributes(request.payloadAttributes)],
    };
    const before = this.getResources();
    // Cleanup owns its reservation independently of a short primary deadline.
    // A primary may use a free worker without waiting for every old end reply.
    if (!alternate && before && before.uncertain > this.orphaned) {
      void this.reconcileResources(AbortSignal.timeout(6000)).catch(() => {});
    }
    if (!alternate) {
      while (this.beginRetry.slot === request.payloadAttributes.slotNumber) {
        const delay = this.beginRetry.after - performance.now();
        if (delay <= 0) break;
        await sleep(delay, signal);
      }
      if (signal.aborted) throw new ErrorAborted();
      if (
        [...this.requests.values()].some(
          (entry) =>
            entry.beginRejected && entry.request.payloadAttributes.slotNumber === request.payloadAttributes.slotNumber
        )
      )
        throw new SessionPayloadError({
          code: SessionPayloadErrorCode.CAPACITY,
          reason: "Rejected constructor begin awaiting cancellation",
        });
    }
    if (signal.aborted) throw new ErrorAborted();
    const resources = this.getResources();
    if (
      resources &&
      (resources.preparing + resources.active + resources.releasing + resources.uncertain >= resources.capacity ||
        (alternate &&
          (resources.active !== 1 ||
            resources.preparing !== 0 ||
            resources.releasing !== 0 ||
            resources.uncertain !== 0)))
    )
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.CAPACITY,
        reason: "Constructor resources occupied",
      });
    if (this.options.beginReservations) return this.prepareReserved(request, signal);
    const beginRpc = this.rpc(bounded ? AbortSignal.timeout(BEGIN_RPC_TIMEOUT_MS) : signal);
    if (bounded) this.preparing++;
    let result: {
      sessionId: string;
      orderGenerationVersion?: number;
      alternateSessionVersion?: number;
      retainedOfferVersion?: number;
      primaryHandoffVersion?: number;
    };
    let disabledReason: AlternateDisabledReason | undefined;
    try {
      // Cancelling the build must not discard a late allocation handle. Keep
      // one bounded request alive, then end any handle the caller no longer owns.
      result = bounded
        ? await beginRpc.fetch<typeof result, typeof call.params>(call, {timeout: BEGIN_RPC_TIMEOUT_MS})
        : await beginRpc.fetch<typeof result, typeof call.params>(call);
    } catch (error) {
      this.noteBeginRejection(request, signal, call.method, error);
      if (bounded) {
        const rejection = error instanceof ErrorJsonRpcResponse ? error.response.error : undefined;
        // Native begin dispatch cleans its allocation before returning an RPC
        // error. Refused connections never send the non-idempotent request.
        const definite = rejection !== undefined || (isFetchError(error) && error.code === "ECONNREFUSED");
        if (!definite) {
          this.orphaned++;
          this.alternatesDisabled = true;
          disabledReason = "ambiguous_begin";
        } else if (
          alternate &&
          rejection &&
          (rejection.code === -32601 ||
            ["UnknownSession", "UnknownMethod", "MethodNotFound", "AlternateLeasesUnsupported"].includes(
              rejection.message
            ))
        ) {
          this.alternatesDisabled = true;
          disabledReason = "unsupported_alternate_method";
        }
      }
      throw error;
    } finally {
      if (bounded) this.preparing--;
      if (disabledReason !== undefined) this.warnAlternatesDisabled(request, signal, disabledReason);
    }
    if (
      typeof result?.sessionId !== "string" ||
      result.sessionId.length === 0 ||
      result.sessionId.length > 128 ||
      (bounded && this.requests.has(result.sessionId))
    ) {
      if (bounded) {
        this.orphaned++;
        this.alternatesDisabled = true;
        this.warnAlternatesDisabled(request, signal, "invalid_begin_handle");
      }
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.INVALID_SESSION,
        reason: "Invalid constructor handle",
      });
    }
    const handle = {sourceId: this.id, fork: request.fork, payloadId: result.sessionId};
    const entry: SessionEntry = {
      request,
      state: "active",
      primaryHandoff: !alternate && result.orderGenerationVersion === 1 && result.primaryHandoffVersion === 1,
      lease:
        result.orderGenerationVersion === 1
          ? {generation: "", validUntil: 0, validUntilUnixMs: 0, ready: false}
          : undefined,
    };
    this.requests.set(result.sessionId, entry);
    if (signal.aborted) {
      await this.release(handle, AbortSignal.timeout(bounded ? 6000 : 1000)).catch(() => {});
      throw new ErrorAborted();
    }
    if (
      alternate &&
      (request.requireRetainedOffer
        ? result.orderGenerationVersion !== 1 ||
          result.alternateSessionVersion !== 2 ||
          result.retainedOfferVersion !== 1
        : result.orderGenerationVersion !== 0 || result.alternateSessionVersion !== 1)
    ) {
      this.alternatesDisabled = true;
      this.warnAlternatesDisabled(request, signal, "unconfirmed_alternate_capability");
      await this.release(handle, AbortSignal.timeout(6000)).catch(() => {});
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED,
        reason: "Constructor did not confirm alternate session capabilities",
      });
    }
    if (
      result.orderGenerationVersion !== undefined &&
      result.orderGenerationVersion !== 0 &&
      result.orderGenerationVersion !== 1
    ) {
      await this.release(handle, AbortSignal.timeout(bounded ? 6000 : 1000)).catch(() => {});
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
        reason: "Unsupported order generation protocol",
      });
    }
    if (!alternate) {
      this.retainedProtocol = result.orderGenerationVersion === 1 && result.retainedOfferVersion === 1;
      this.primaryHandoffProtocol = entry.primaryHandoff === true;
    }
    this.resetBeginRetry(request);
    return handle;
  }

  /** Reserve an allocation identity before sending the non-idempotent begin.
   * A lost reserve reply cannot allocate a worker. Once known, the ticket stays
   * counted until the constructor proves neither queued nor attached work can
   * survive. A timeout or a changed server instance is not that proof.
   */
  private async prepareReserved(request: BuildRequest, signal: AbortSignal): Promise<BuildHandle> {
    this.preparing++;
    let ticket: string | undefined;
    let method = request.requireRetainedOffer ? "zbuilder_reserveAlternateBeginV1" : "zbuilder_reserveBeginV1";
    let disabledReason: AlternateDisabledReason | undefined;
    try {
      const reservation = await this.rpc(signal).fetch<{reservationId: string; beginReservationVersion: number}>(
        {method, params: request.requireRetainedOffer ? [] : [request.requireUnleased === true]},
        {timeout: 1000}
      );
      if (
        reservation?.beginReservationVersion !== 1 ||
        typeof reservation.reservationId !== "string" ||
        !/^begin-[0-9a-f]{32}-[1-9][0-9]{0,19}$/.test(reservation.reservationId) ||
        BigInt(reservation.reservationId.slice(39)) > 0xffffffffffffffffn ||
        this.requests.has(reservation.reservationId)
      )
        throw new SessionPayloadError({
          code: SessionPayloadErrorCode.INVALID_SESSION,
          reason: "Invalid constructor reservation",
        });
      ticket = reservation.reservationId;
      if (signal.aborted) throw new ErrorAborted();
      method = "zbuilder_beginReservedV1";
      const result = await this.rpc(AbortSignal.timeout(BEGIN_RPC_TIMEOUT_MS)).fetch<{
        sessionId: string;
        beginReservationVersion: number;
        orderGenerationVersion: number;
        alternateSessionVersion: number;
        retainedOfferVersion?: number;
        primaryHandoffVersion?: number;
      }>(
        {
          method: "zbuilder_beginReservedV1",
          params: [
            ticket,
            request.forkchoiceState.headBlockHash,
            serializePayloadAttributes(request.payloadAttributes),
          ],
        },
        {timeout: BEGIN_RPC_TIMEOUT_MS}
      );
      if (
        result?.sessionId !== ticket ||
        result.beginReservationVersion !== 1 ||
        (result.orderGenerationVersion !== 0 && result.orderGenerationVersion !== 1) ||
        (!isAlternateBuild(request) && result.alternateSessionVersion !== 0) ||
        (request.requireRetainedOffer &&
          (result.orderGenerationVersion !== 1 ||
            result.alternateSessionVersion !== 2 ||
            result.retainedOfferVersion !== 1)) ||
        (request.requireUnleased && (result.orderGenerationVersion !== 0 || result.alternateSessionVersion !== 1))
      ) {
        if (isAlternateBuild(request)) disabledReason = "unconfirmed_alternate_capability";
        throw new SessionPayloadError({
          code: SessionPayloadErrorCode.INVALID_SESSION,
          reason: "Constructor did not confirm reserved session capabilities",
        });
      }
      this.requests.set(ticket, {
        request,
        state: "active",
        reserved: true,
        primaryHandoff:
          !isAlternateBuild(request) && result.orderGenerationVersion === 1 && result.primaryHandoffVersion === 1,
        lease:
          result.orderGenerationVersion === 1
            ? {generation: "", validUntil: 0, validUntilUnixMs: 0, ready: false}
            : undefined,
      });
      if (!isAlternateBuild(request)) {
        this.retainedProtocol = result.orderGenerationVersion === 1 && result.retainedOfferVersion === 1;
        this.primaryHandoffProtocol = result.orderGenerationVersion === 1 && result.primaryHandoffVersion === 1;
      }
      this.resetBeginRetry(request);
      if (signal.aborted) throw new ErrorAborted();
      return {sourceId: this.id, fork: request.fork, payloadId: ticket};
    } catch (error) {
      const rejected = this.noteBeginRejection(request, signal, method, error, ticket);
      if (isAlternateBuild(request) && error instanceof ErrorJsonRpcResponse) {
        const rejection = error.response.error;
        if (
          rejection.code === -32601 ||
          ["MethodNotSupported", "UnknownMethod", "MethodNotFound", "AlternateLeasesUnsupported"].includes(
            rejection.message
          )
        )
          disabledReason = "unsupported_alternate_method";
      }
      if (disabledReason !== undefined) {
        this.alternatesDisabled = true;
        this.warnAlternatesDisabled(request, signal, disabledReason, method);
      }
      if (ticket !== undefined) {
        const entry: SessionEntry = this.requests.get(ticket) ?? {request, state: "uncertain", reserved: true};
        entry.state = "uncertain";
        entry.beginRejected =
          !isAlternateBuild(request) && (rejected === "SlotNotArmed" || rejected === "ConstructionHalted");
        this.requests.set(ticket, entry);
        if (!rejected) {
          try {
            this.options.logger?.warn("Constructor begin awaiting confirmed cancellation", {
              code: "SESSION_PAYLOAD_BEGIN_UNCERTAIN",
              slot: request.payloadAttributes.slotNumber,
              sessionId: ticket,
              callerAborted: signal.aborted,
            });
          } catch {
            // Diagnostic failures cannot change ticket ownership.
          }
        }
      }
      throw error;
    } finally {
      this.preparing--;
      if (ticket !== undefined && this.requests.get(ticket)?.state === "uncertain") {
        void this.reconcileResources(AbortSignal.timeout(6000)).catch(() => {});
      }
    }
  }

  async getPayload(handle: BuildHandle, signal: AbortSignal): Promise<BuiltPayload> {
    if (signal.aborted) throw new ErrorAborted();
    const entry = this.requests.get(handle.payloadId);
    if (handle.sourceId !== this.id || !entry || entry.state !== "active" || entry.request.fork !== handle.fork) {
      throw new SessionPayloadError({code: SessionPayloadErrorCode.UNKNOWN_HANDLE, reason: handle.payloadId});
    }
    if (entry.request.requireRetainedOffer) return this.getRetainedPayload(handle, entry, signal);
    const started = performance.now();
    const startedUnix = Date.now();
    const call = {
      method: entry.lease ? "zbuilder_getPayloadV2" : "zbuilder_getPayloadV1",
      params: entry.latest
        ? [
            handle.payloadId,
            toHex(entry.latest.executionPayload.blockHash),
            ...(entry.lease ? [entry.lease.generation] : []),
          ]
        : [handle.payloadId],
    };
    let received: PayloadResponse | LeasedResponse | null;
    try {
      received = await this.rpc(signal).fetch<PayloadResponse | LeasedResponse | null>(call);
    } catch (error) {
      if (signal.aborted) throw new ErrorAborted();
      if (!isFetchError(error) || (error.code !== "UND_ERR_SOCKET" && error.code !== "ECONNRESET")) {
        if (entry.lease) entry.lease.ready = false;
        throw error;
      }
      // Only this idempotent read may retry a pooled socket closing. Preserve
      // the slot's cancellation deadline and never replay begin/append calls.
      try {
        received = await this.rpc(signal).fetch<PayloadResponse | LeasedResponse | null>(call);
      } catch (retryError) {
        if (entry.lease) entry.lease.ready = false;
        throw retryError;
      }
    }
    if (signal.aborted) throw new ErrorAborted();
    if (this.requests.get(handle.payloadId) !== entry || entry.state !== "active")
      throw new SessionPayloadError({code: SessionPayloadErrorCode.UNKNOWN_HANDLE, reason: handle.payloadId});
    let response: PayloadResponse | null;
    let namespace: string | undefined;
    let orderMetadata: OrderMetadata | undefined;
    if (entry.lease) {
      entry.lease.ready = false;
      const result = received as LeasedResponse | null;
      if (
        !result ||
        typeof result.generation !== "string" ||
        !/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/.test(result.generation) ||
        result.leaseMs !== 250 ||
        typeof result.ready !== "boolean" ||
        !("payload" in result)
      )
        throw new SessionPayloadError({code: SessionPayloadErrorCode.RESPONSE_MISMATCH, reason: "Invalid offer lease"});
      if (entry.primaryHandoff && this.options.primaryHandoff) {
        namespace =
          typeof result.namespace === "string" && /^0x[0-9a-f]{32}$/.test(result.namespace)
            ? result.namespace
            : undefined;
        if (entry.latest?.offerEligibility && entry.latest.offerEligibility.namespace !== namespace) {
          // A conditional reply may renew ordinary permission, but cannot
          // rebind an older immutable snapshot to another handoff namespace.
          entry.latest = {
            ...entry.latest,
            offerEligibility: {...entry.latest.offerEligibility, namespace: undefined},
          };
        }
      }
      const previous = entry.lease.generation;
      if (previous && BigInt(result.generation) < BigInt(previous))
        throw new SessionPayloadError({
          code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
          reason: "Order generation rollback",
        });
      entry.lease.generation = result.generation;
      entry.lease.validUntil = started + result.leaseMs;
      // Linux's monotonic clock can stop during suspend. Require the wall-clock
      // allowance too; ordinary clock corrections can only shorten a live lease.
      entry.lease.validUntilUnixMs = startedUnix + result.leaseMs;
      if (previous !== result.generation) entry.latest = undefined;
      if (!result.ready) throw new PayloadSourceNotReady();
      orderMetadata = parseOrderMetadata(result.orderMetadata);
      response = result.payload;
      if (response === null && entry.latest && !sameOrderMetadata(entry.latest.orderMetadata, orderMetadata))
        throw new SessionPayloadError({
          code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
          reason: "Order metadata changed for unchanged payload",
        });
      if (response === null && !entry.latest)
        throw new SessionPayloadError({
          code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
          reason: "Missing initial generation payload",
        });
    } else response = received as PayloadResponse | null;
    try {
      if (response !== null) {
        entry.latest = validateSessionPayload(this.id, entry.request, response);
        entry.latest.orderMetadata = orderMetadata;
        if (entry.lease)
          entry.latest.offerEligibility = {
            generation: entry.lease.generation,
            namespace,
            lease: entry.lease,
            doNotOfferBefore: orderMetadata?.doNotOfferBefore,
          };
      }
      if (!entry.latest)
        throw new SessionPayloadError({code: SessionPayloadErrorCode.RESPONSE_MISMATCH, reason: "No initial payload"});
      if (entry.lease) {
        // A large reply may consume its whole lease. Cache its verified bytes,
        // but require a fresh, small conditional read before making an offer.
        entry.lease.ready =
          isOrderOfferAllowed(entry.latest.orderMetadata) &&
          performance.now() < entry.lease.validUntil &&
          Date.now() < entry.lease.validUntilUnixMs;
        if (!entry.lease.ready) throw new PayloadSourceNotReady();
      }
      return entry.latest;
    } catch (error) {
      if (entry.lease) entry.lease.ready = false;
      throw error;
    }
  }

  async retainPrimaryPayload(handle: BuildHandle, payload: BuiltPayload, signal: AbortSignal): Promise<BuiltPayload> {
    const entry = this.requests.get(handle.payloadId);
    const eligibility = payload.offerEligibility;
    if (
      !isOrderOfferAllowed(payload.orderMetadata) ||
      !this.supportsPrimaryHandoff ||
      !entry?.primaryHandoff ||
      entry.state !== "active" ||
      entry.handoffRequested ||
      isAlternateBuild(entry.request) ||
      handle.sourceId !== this.id ||
      payload.sourceId !== this.id ||
      handle.fork !== entry.request.fork ||
      payload.fork !== handle.fork ||
      !eligibility?.namespace ||
      !/^0x[0-9a-f]{32}$/.test(eligibility.namespace) ||
      eligibility.namespace !== entry.latest?.offerEligibility?.namespace ||
      !/^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/.test(eligibility.generation) ||
      eligibility.retained ||
      eligibility.lease !== entry.lease ||
      toHex(payload.executionPayload.parentHash) !== entry.request.forkchoiceState.headBlockHash
    )
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.ALTERNATE_UNSUPPORTED,
        reason: "Primary handoff unavailable",
      });
    signal.throwIfAborted();
    const context = {
      namespace: eligibility.namespace,
      generation: eligibility.generation,
      slot: `0x${entry.request.payloadAttributes.slotNumber.toString(16)}`,
      parentHash: entry.request.forkchoiceState.headBlockHash,
      parentBeaconBlockRoot: toHex(entry.request.payloadAttributes.parentBeaconBlockRoot),
      blockHash: toHex(payload.executionPayload.blockHash),
    };
    entry.handoffRequested = true;
    const started = performance.now();
    const startedUnix = Date.now();
    const result = await this.rpc(signal).fetch<RetainedLeaseResponse>(
      {method: "zbuilder_retainPrimaryPayloadV1", params: [handle.payloadId, context]},
      {timeout: 25}
    );
    const instance = /^(?:native|begin)-([0-9a-f]{32})-/.exec(handle.payloadId)?.[1];
    const token = /^offer-([0-9a-f]{32})-([1-9][0-9]{0,19})$/.exec(result?.offerId ?? "");
    if (!instance || token?.[1] !== instance || BigInt(token[2]) > 0xffffffffffffffffn)
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
        reason: "Invalid primary handoff identity",
      });
    const retained: BuiltPayload = {
      ...payload,
      offerEligibility: {
        generation: context.generation,
        doNotOfferBefore: payload.orderMetadata?.doNotOfferBefore,
        namespace: context.namespace,
        retained: {id: result.offerId, ...context, closed: false},
        lease: {generation: context.generation, validUntil: 0, validUntilUnixMs: 0, ready: false},
      },
    };
    try {
      this.applyRetainedLease(retained, result, started, startedUnix);
      signal.throwIfAborted();
      if (this.requests.get(handle.payloadId) !== entry || entry.state !== "active")
        throw new SessionPayloadError({code: SessionPayloadErrorCode.UNKNOWN_HANDLE, reason: handle.payloadId});
      if (!retained.offerEligibility?.lease.ready) throw new PayloadSourceNotReady();
      return retained;
    } catch (error) {
      await this.releaseOffer(retained, AbortSignal.timeout(1000)).catch(() => {});
      throw error;
    }
  }

  private async getRetainedPayload(
    handle: BuildHandle,
    entry: SessionEntry,
    signal: AbortSignal
  ): Promise<BuiltPayload> {
    const started = performance.now();
    const startedUnix = Date.now();
    let result: RetainedResponse;
    try {
      result = await this.rpc(signal).fetch<RetainedResponse>({
        method: "zbuilder_getRetainedPayloadV1",
        params: [handle.payloadId],
      });
    } catch (error) {
      if (
        error instanceof ErrorJsonRpcResponse &&
        ["PayloadNotReady", "StaleOrderGeneration"].includes(error.response.error.message)
      )
        throw new PayloadSourceNotReady();
      throw error;
    }
    // A token must belong to the same constructor instance as its allocation.
    const instance = /^(?:native|begin)-([0-9a-f]{32})-/.exec(handle.payloadId)?.[1];
    const token = /^offer-([0-9a-f]{32})-([1-9][0-9]{0,19})$/.exec(result?.offerId ?? "");
    if (!instance || token?.[1] !== instance || BigInt(token[2]) > 0xffffffffffffffffn)
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
        reason: "Invalid retained offer identity",
      });
    let payload: BuiltPayload | undefined;
    try {
      payload = validateSessionPayload(this.id, entry.request, result.payload);
      payload.orderMetadata = parseOrderMetadata(result.orderMetadata);
      const retained: RetainedOffer = {
        id: result.offerId,
        namespace: result.namespace,
        parentHash: entry.request.forkchoiceState.headBlockHash,
        parentBeaconBlockRoot: toHex(entry.request.payloadAttributes.parentBeaconBlockRoot),
        blockHash: toHex(payload.executionPayload.blockHash),
        slot: `0x${entry.request.payloadAttributes.slotNumber.toString(16)}`,
        closed: false,
      };
      payload.offerEligibility = {
        generation: result.generation,
        doNotOfferBefore: payload.orderMetadata?.doNotOfferBefore,
        retained,
        lease: {generation: result.generation, validUntil: 0, validUntilUnixMs: 0, ready: false},
      };
      this.applyRetainedLease(payload, result, started, startedUnix);
      signal.throwIfAborted();
      if (this.requests.get(handle.payloadId) !== entry || entry.state !== "active")
        throw new SessionPayloadError({code: SessionPayloadErrorCode.UNKNOWN_HANDLE, reason: handle.payloadId});
      // Large payload serialization may consume the initial lease. A small exact
      // token read can recover permission without transferring the payload again.
      if (!payload.offerEligibility.lease.ready && !(await this.renewOffer(payload, signal)))
        throw new PayloadSourceNotReady();
      entry.latest = payload;
      return payload;
    } catch (error) {
      if (payload?.offerEligibility?.retained) {
        await this.releaseOffer(payload, AbortSignal.timeout(1000)).catch(() => {});
      } else {
        await this.rpc(AbortSignal.timeout(1000))
          .fetch({method: "zbuilder_releasePayloadOfferV1", params: [result.offerId]})
          .catch(() => {});
      }
      throw error;
    }
  }

  private applyRetainedLease(
    payload: BuiltPayload,
    result: RetainedLeaseResponse,
    started: number,
    startedUnix: number,
    pauseEpoch = 0
  ): void {
    const eligibility = payload.offerEligibility;
    const retained = eligibility?.retained;
    if (!eligibility || !retained) throw new Error("Missing retained offer");
    // A reply from an earlier context cannot either renew or overwrite a
    // newer context's permission. The caller serializes ordinary renewals.
    if ((retained.pauseEpoch ?? 0) !== pauseEpoch || retained.paused) return;
    eligibility.lease.ready = false;
    const quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/;
    if (
      result?.retainedOfferVersion !== 1 ||
      result.offerId !== retained.id ||
      typeof result.namespace !== "string" ||
      !/^0x[0-9a-f]{32}$/.test(result.namespace) ||
      result.namespace !== retained.namespace ||
      typeof result.generation !== "string" ||
      !quantity.test(result.generation) ||
      result.generation !== eligibility.generation ||
      typeof result.currentGeneration !== "string" ||
      !quantity.test(result.currentGeneration) ||
      BigInt(result.currentGeneration) < BigInt(result.generation) ||
      !Number.isSafeInteger(result.leaseMs) ||
      result.leaseMs < 0 ||
      result.leaseMs > 250 ||
      typeof result.ready !== "boolean" ||
      (result.ready && (result.leaseMs === 0 || result.generation !== result.currentGeneration)) ||
      result.parentHash !== retained.parentHash ||
      result.parentBeaconBlockRoot !== retained.parentBeaconBlockRoot ||
      result.blockHash !== retained.blockHash ||
      result.slot !== retained.slot
    )
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
        reason: "Retained offer context mismatch",
      });
    if (!sameOrderMetadata(payload.orderMetadata, parseOrderMetadata(result.orderMetadata)))
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
        reason: "Retained order metadata changed",
      });
    if (retained.closed) return;
    eligibility.lease.validUntil = started + result.leaseMs;
    eligibility.lease.validUntilUnixMs = startedUnix + result.leaseMs;
    // A generation transition permanently revokes this token, even if the exact
    // same bytes are built again later. Reauthorization requires a new token.
    if (result.currentGeneration !== eligibility.generation || !result.ready) retained.closed = true;
    eligibility.lease.ready =
      !retained.closed &&
      isOrderOfferAllowed(payload.orderMetadata) &&
      performance.now() < eligibility.lease.validUntil &&
      Date.now() < eligibility.lease.validUntilUnixMs;
  }

  async renewOffer(payload: BuiltPayload, signal: AbortSignal): Promise<boolean> {
    const eligibility = payload.offerEligibility;
    const retained = eligibility?.retained;
    if (payload.sourceId !== this.id || !eligibility || !retained || retained.closed || retained.paused) return false;
    const pauseEpoch = retained.pauseEpoch ?? 0;
    const started = performance.now();
    const startedUnix = Date.now();
    try {
      const result = await this.rpc(signal).fetch<RetainedResponse>(
        {method: "zbuilder_renewPayloadOfferV1", params: [retained.id]},
        {timeout: 250}
      );
      signal.throwIfAborted();
      this.applyRetainedLease(payload, result, started, startedUnix, pauseEpoch);
      return !retained.paused && (retained.pauseEpoch ?? 0) === pauseEpoch && eligibility.lease.ready;
    } catch (error) {
      if ((retained.pauseEpoch ?? 0) === pauseEpoch) {
        eligibility.lease.ready = false;
        if (error instanceof ErrorJsonRpcResponse || error instanceof SessionPayloadError) retained.closed = true;
      }
      throw error;
    }
  }

  async releaseOffer(payload: BuiltPayload, signal: AbortSignal): Promise<void> {
    const eligibility = payload.offerEligibility;
    const retained = eligibility?.retained;
    if (payload.sourceId !== this.id || !eligibility || !retained) return;
    retained.closed = true;
    eligibility.lease.ready = false;
    const result = await this.rpc(signal).fetch(
      {method: "zbuilder_releasePayloadOfferV1", params: [retained.id]},
      {timeout: 1000}
    );
    if (result !== true)
      throw new SessionPayloadError({
        code: SessionPayloadErrorCode.RESPONSE_MISMATCH,
        reason: "Retained offer release unconfirmed",
      });
  }

  async release(handle: BuildHandle, signal: AbortSignal): Promise<void> {
    const entry = this.requests.get(handle.payloadId);
    if (!this.tracksSessions) {
      if (entry?.lease) entry.lease.ready = false;
      this.requests.delete(handle.payloadId);
      await this.rpc(signal).fetch({method: "zbuilder_endV1", params: [handle.payloadId]});
      return;
    }
    if (handle.sourceId !== this.id || !entry || entry.request.fork !== handle.fork)
      throw new SessionPayloadError({code: SessionPayloadErrorCode.UNKNOWN_HANDLE, reason: handle.payloadId});
    if (entry.lease) entry.lease.ready = false;
    if (entry.release !== undefined) return entry.release;
    entry.state = "releasing";
    entry.release = Promise.resolve()
      .then(async () => {
        const cleanup = entry.reserved ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : signal;
        let retryTransport = true;
        while (true) {
          cleanup.throwIfAborted();
          let result: boolean | {released: boolean; beginReservationVersion: number};
          try {
            result = await this.rpc(cleanup).fetch<typeof result>({
              method: entry.reserved ? "zbuilder_cancelBeginV1" : "zbuilder_endV1",
              params: [handle.payloadId],
            });
          } catch (error) {
            const transportFailure = isFetchError(error)
              ? error.type === "failed"
              : error instanceof TypeError &&
                error.cause instanceof Error &&
                "code" in error.cause &&
                (error.cause.code === "UND_ERR_SOCKET" || error.cause.code === "ECONNRESET");
            if (!retryTransport || cleanup.aborted || !transportFailure) throw error;
            // A new primary may already have checked for uncertainty. Retry the
            // idempotent cleanup once, under the same ownership and deadline.
            retryTransport = false;
            await sleep(100, cleanup);
            continue;
          }
          if (!entry.reserved) return result;
          if (typeof result !== "object")
            throw new SessionPayloadError({
              code: SessionPayloadErrorCode.RELEASE_UNCONFIRMED,
              reason: handle.payloadId,
            });
          if (result?.beginReservationVersion !== 1 || typeof result.released !== "boolean")
            throw new SessionPayloadError({
              code: SessionPayloadErrorCode.RELEASE_UNCONFIRMED,
              reason: handle.payloadId,
            });
          if (result.released) return true;
          await sleep(100, cleanup);
        }
      })
      .then((result) => {
        if (result !== true)
          throw new SessionPayloadError({code: SessionPayloadErrorCode.RELEASE_UNCONFIRMED, reason: handle.payloadId});
        this.requests.delete(handle.payloadId);
      })
      .catch((error: unknown) => {
        entry.state = "uncertain";
        try {
          if (
            entry.reserved &&
            error instanceof ErrorJsonRpcResponse &&
            error.response.error.code === -32000 &&
            error.response.error.message === "BeginReservationInstanceMismatch"
          ) {
            entry.reconcileFailures = Math.min(4, (entry.reconcileFailures ?? 0) + 1);
            entry.reconcileAfter = performance.now() + Math.min(BEGIN_RETRY_MAX_MS, 100 * 2 ** entry.reconcileFailures);
          }
        } catch {
          // An unreadable response still retains ownership and its original error.
        }
        if (
          !entry.reserved &&
          error instanceof ErrorJsonRpcResponse &&
          error.response.error.code === -32000 &&
          error.response.error.message === "UnknownSession" &&
          /^native-[0-9a-f]{32}-[01]-(?:0|[1-9][0-9]{0,19})$/.test(handle.payloadId) &&
          BigInt(handle.payloadId.slice(handle.payloadId.lastIndexOf("-") + 1)) <= 0xffffffffffffffffn
        ) {
          this.requests.delete(handle.payloadId);
          return;
        }
        throw error;
      })
      .finally(() => {
        entry.release = undefined;
      });
    return entry.release;
  }
}

function validateSessionPayload(sourceId: string, request: BuildRequest, response: PayloadResponse): BuiltPayload {
  const fail = (reason: string): never => {
    throw new SessionPayloadError({code: SessionPayloadErrorCode.RESPONSE_MISMATCH, reason});
  };
  const parsed = parseExecutionPayload(ForkName.gloas, response);
  const executionPayload = parsed.executionPayload as BuiltPayload["executionPayload"];
  const {blobsBundle, executionRequests, executionPayloadValue} = parsed;
  if (
    !blobsBundle ||
    !executionRequests ||
    !("builderDeposits" in executionRequests) ||
    !("builderExits" in executionRequests)
  ) {
    return fail("Missing Gloas payload data");
  }
  const attrs = request.payloadAttributes;
  if (
    toHex(executionPayload.parentHash).toLowerCase() !== request.forkchoiceState.headBlockHash.toLowerCase() ||
    executionPayload.timestamp !== attrs.timestamp ||
    executionPayload.slotNumber !== attrs.slotNumber ||
    toHex(executionPayload.prevRandao) !== toHex(attrs.prevRandao) ||
    toHex(executionPayload.feeRecipient).toLowerCase() !== attrs.suggestedFeeRecipient.toLowerCase() ||
    !ssz.capella.Withdrawals.equals(executionPayload.withdrawals, attrs.withdrawals) ||
    executionPayload.extraData.length > 32
  )
    return fail("Payload differs from the session parent or attributes");
  if (executionPayloadValue < 0n) return fail("Negative payload value");
  // Authentication belongs to the constructor. Check the complete ordered
  // reveal data before this adapter can offer anything for signing. Repeated
  // versioned hashes still require repeated entries in the payload bundle.
  const hashes: Uint8Array[] = [];
  try {
    for (const transaction of executionPayload.transactions) {
      if (transaction[0] !== 3) continue;
      const fields = RLP.decode(transaction.subarray(1));
      if (!Array.isArray(fields) || fields.length !== 14 || !Array.isArray(fields[10]) || !fields[10].length)
        return fail("Invalid blob transaction");
      for (const hash of fields[10]) {
        if (!(hash instanceof Uint8Array) || hash.length !== 32 || hash[0] !== 1)
          return fail("Invalid blob versioned hash");
        hashes.push(hash);
      }
    }
  } catch {
    return fail("Invalid blob transaction encoding");
  }
  if (
    hashes.length > 64 ||
    executionPayload.blobGasUsed !== BigInt(hashes.length * 131072) ||
    blobsBundle.blobs.length !== hashes.length ||
    blobsBundle.commitments.length !== hashes.length ||
    blobsBundle.proofs.length !== hashes.length * CELLS_PER_EXT_BLOB ||
    blobsBundle.blobs.some((blob) => blob.length !== FIELD_ELEMENTS_PER_BLOB * 32) ||
    blobsBundle.commitments.some((commitment) => commitment.length !== 48) ||
    blobsBundle.proofs.some((proof) => proof.length !== 48)
  )
    return fail("Incomplete blob reveal data");
  for (const [i, commitment] of blobsBundle.commitments.entries()) {
    const hash = createHash("sha256").update(commitment).digest();
    hash[0] = 1;
    if (!hash.equals(hashes[i])) return fail("Blob commitment order differs from transactions");
  }
  return {sourceId, fork: request.fork, executionPayload, executionRequests, blobsBundle, executionPayloadValue};
}
