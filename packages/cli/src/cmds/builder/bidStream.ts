import {randomBytes} from "node:crypto";
import {IncomingMessage} from "node:http";
import {Duplex} from "node:stream";
import websocket from "@fastify/websocket";
import {FastifyInstance, FastifyRequest, FastifySchema} from "fastify";
import {WebSocket} from "ws";
import {ApiError} from "@lodestar/api/server";
import {BidStreamRequest, BuilderBidStreamApi, RetainedBidStream} from "@lodestar/builder";
import {ssz} from "@lodestar/types";
import {Logger, fromHex, toHex} from "@lodestar/utils";

export const BID_STREAM_PATH =
  "/eth/v1/builder/execution_payload_bid_stream/:slot/:parent_hash/:parent_root/:proposer_pubkey";
const MAX_STREAMS = 64;
const MAX_PROPOSER_STREAMS = 4;
const MAX_AUTH_BASE64_BYTES = 5612;
const MAX_FRAME_BYTES = 1024 * 1024;
const CLOSE_GRACE_MS = 100;
const MAX_CLIENT_PINGS = 32;
const ELIGIBILITY_RECHECK_MS = 25;
const FRAME_VERSION = 1;
const GLOAS_FORK = 7;

type SubscribeAbort = (signal: AbortSignal | undefined, notify: () => void) => () => void;

type Admission = {
  request: BidStreamRequest;
  userAgent?: string;
  transitMs: number;
  terminate(): void;
  upgrade(): void;
  release(): void;
  authenticationDone(): void;
  authenticated?: RetainedBidStream;
  expired: boolean;
  timer: NodeJS.Timeout;
};

export async function registerBidStream(
  server: FastifyInstance,
  getApi: () => BuilderBidStreamApi | null,
  logger: Logger,
  slotDurationMs: number,
  adaptiveTiming = false
): Promise<void> {
  const requests = new WeakMap<FastifyRequest, Admission>();
  const proposers = new Map<string, number>();
  let active = 0;
  const pending = new Set<Admission>();
  const transports = new Set<Duplex>();
  const upgradeTimers = new Map<Duplex, NodeJS.Timeout>();
  const finishUpgrade = (socket: Duplex): void => {
    clearTimeout(upgradeTimers.get(socket));
    upgradeTimers.delete(socket);
  };
  const guardUpgrade = (request: IncomingMessage, socket: Duplex): void => {
    if (transports.size >= MAX_STREAMS) {
      socket.destroy();
      return;
    }
    transports.add(socket);
    upgradeTimers.set(
      socket,
      setTimeout(() => socket.destroy(), 2 * slotDurationMs)
    );
    socket.once("close", () => {
      finishUpgrade(socket);
      transports.delete(socket);
    });
    try {
      decodeURIComponent(request.url ?? "");
    } catch {
      socket.destroy();
    }
  };
  // Router errors can write a response without Fastify hooks. Every raw upgrade
  // therefore has its own socket/work bound before the plugin handles it.
  server.server.prependListener("upgrade", guardUpgrade);
  const abortSubscribers = new Map<AbortSignal, {notify: () => void; subscribers: Set<() => void>}>();
  const subscribeAbort: SubscribeAbort = (signal, notify) => {
    if (!signal) return () => {};
    if (signal.aborted) {
      notify();
      return () => {};
    }
    let entry = abortSubscribers.get(signal);
    if (!entry) {
      const subscribers = new Set<() => void>();
      entry = {
        notify: () => {
          for (const callback of subscribers) callback();
        },
        subscribers,
      };
      abortSubscribers.set(signal, entry);
      signal.addEventListener("abort", entry.notify, {once: true});
    }
    entry.subscribers.add(notify);
    return () => {
      entry.subscribers.delete(notify);
      if (entry.subscribers.size === 0 && abortSubscribers.get(signal) === entry) {
        signal.removeEventListener("abort", entry.notify);
        abortSubscribers.delete(signal);
      }
    };
  };
  const previousUpgradeListeners = new Set(server.server.listeners("upgrade"));
  const upgradeListeners: Array<(...args: unknown[]) => void> = [];
  // ws 8.22 supports autoPong; disable it so control frames obey our write bound too.
  const socketOptions = {maxPayload: 125, perMessageDeflate: false, autoPong: false};

  await server.register(websocket, {
    options: socketOptions,
    errorHandler(_error, socket) {
      socket.terminate();
    },
    preClose(done) {
      this.server.removeListener("upgrade", guardUpgrade);
      for (const socket of transports) socket.destroy();
      for (const listener of upgradeListeners) this.server.removeListener("upgrade", listener);
      for (const admission of pending) admission.terminate();
      for (const socket of this.websocketServer.clients) socket.terminate();
      this.websocketServer.close(done);
    },
  });

  for (const listener of server.server.listeners("upgrade")) {
    if (!previousUpgradeListeners.has(listener)) upgradeListeners.push(listener as (...args: unknown[]) => void);
  }

  server.addHook("onError", async (request) => requests.get(request)?.release());
  server.addHook("onResponse", async (request) => requests.get(request)?.release());
  const schema: FastifySchema & {operationId: string} = {operationId: "getExecutionPayloadBidStream"};
  server.route({
    method: "GET",
    url: BID_STREAM_PATH,
    schema,
    async preValidation(request, reply) {
      if (!request.ws) return;
      if (request.raw.socket.destroyed) throw new ApiError(503, "BID_STREAM_SOCKET_CLOSED");
      if (
        request.headers.upgrade?.toLowerCase() !== "websocket" ||
        request.headers["sec-websocket-version"] !== "13" ||
        typeof request.headers["sec-websocket-key"] !== "string" ||
        !/^[+/0-9A-Za-z]{22}==$/.test(request.headers["sec-websocket-key"])
      )
        throw new ApiError(400, "Invalid WebSocket handshake");
      const arrivedAt = Date.now();
      const args = parseBidStreamRequest(request);
      const api = getApi();
      if (!api || api.signal?.aborted) throw new ApiError(503, "Builder is not ready");
      const proposer = Buffer.from(args.proposerPubkey).toString("hex");
      if (active >= MAX_STREAMS) {
        throw new ApiError(429, "BID_STREAM_CAPACITY");
      }
      active++;
      let proposerAdmitted = false;
      let authenticating = true;
      let releaseRequested = false;
      let released = false;
      let removeAbort = (): void => {};
      const release = (): void => {
        releaseRequested = true;
        // Disconnects do not free the work slot while a duty lookup is still running.
        if (released || authenticating) return;
        released = true;
        clearTimeout(admission.timer);
        pending.delete(admission);
        removeAbort();
        active--;
        if (proposerAdmitted) {
          const remaining = (proposers.get(proposer) ?? 1) - 1;
          if (remaining === 0) proposers.delete(proposer);
          else proposers.set(proposer, remaining);
        }
        request.raw.socket.removeListener("close", onDisconnect);
      };
      const onDisconnect = (): void => {
        admission.expired = true;
        release();
      };
      const admission: Admission = {
        request: args,
        userAgent: request.headers["user-agent"]?.slice(0, 256),
        transitMs: arrivedAt - args.dateMilliseconds,
        terminate() {
          admission.expired = true;
          request.raw.socket.destroy();
          release();
        },
        upgrade() {
          pending.delete(admission);
          removeAbort();
        },
        release,
        authenticationDone() {
          authenticating = false;
          if (releaseRequested) release();
        },
        expired: false,
        timer: setTimeout(() => admission.terminate(), Math.max(1, Math.min(args.timeoutMs, 2 * slotDurationMs))),
      };
      requests.set(request, admission);
      pending.add(admission);
      removeAbort = subscribeAbort(api.signal, () => admission.terminate());
      request.raw.socket.once("close", onDisconnect);
      const authStarted = performance.now();
      try {
        admission.authenticated = await api.open(args);
      } finally {
        admission.authenticationDone();
      }
      if (admission.expired) throw new ApiError(408, "BID_STREAM_AUTH_TIMEOUT");
      clearTimeout(admission.timer);
      if (performance.now() >= admission.authenticated.deadline) {
        release();
        const adaptiveDeadline = adaptiveTiming ? admission.authenticated.hardDeadline : undefined;
        try {
          logger.info("Builder bid stream admission expired", {
            code: "BID_STREAM_DEADLINE_BEFORE_UPGRADE",
            slot: args.slot,
            parentHash: toHex(args.parentHash),
            parentRoot: toHex(args.parentRoot),
            timeoutMs: args.timeoutMs,
            adaptiveTiming: adaptiveDeadline !== undefined,
            transitMs: admission.transitMs,
            authenticationMs: Math.round(performance.now() - authStarted),
            deadlineFromAuthStartMs: Math.round(admission.authenticated.deadline - authStarted),
            hardStopFromAuthStartMs: Math.round(
              (adaptiveDeadline?.monotonic ?? admission.authenticated.deadline) - authStarted
            ),
          });
        } catch {
          // Diagnostics must not change admission or retain its capacity.
        }
        return reply.code(204).send();
      }
      const count = proposers.get(proposer) ?? 0;
      if (count >= MAX_PROPOSER_STREAMS) throw new ApiError(429, "BID_STREAM_CAPACITY");
      proposerAdmitted = true;
      proposers.set(proposer, count + 1);
    },
    handler(_request, reply) {
      return reply.code(426).send({code: 426, message: "WebSocket upgrade required"});
    },
    wsHandler(socket, request) {
      const admission = requests.get(request);
      if (!admission?.authenticated || admission.expired) {
        socket.terminate();
        admission?.release();
        return;
      }
      finishUpgrade(request.raw.socket);
      admission.upgrade();
      serveBidStream(
        socket,
        admission.authenticated,
        admission.release,
        logger,
        admission,
        subscribeAbort,
        adaptiveTiming
      );
    },
  });
}

function parseBidStreamRequest(request: FastifyRequest): BidStreamRequest {
  const params = request.params as Record<string, string>;
  const integer = (value: unknown, name: string): number => {
    if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new ApiError(400, `Invalid ${name}`);
    }
    return Number(value);
  };
  const bytes = (value: unknown, length: number, name: string): Uint8Array => {
    if (typeof value !== "string" || !new RegExp(`^0x[0-9a-fA-F]{${length * 2}}$`).test(value)) {
      throw new ApiError(400, `Invalid ${name}`);
    }
    return fromHex(value);
  };
  if (request.headers["eth-consensus-version"] !== "gloas") throw new ApiError(400, "Bid stream requires Gloas");
  const encoded = request.headers["x-request-auth"];
  if (
    typeof encoded !== "string" ||
    encoded.length === 0 ||
    encoded.length > MAX_AUTH_BASE64_BYTES ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new ApiError(400, "Invalid X-Request-Auth");
  }
  const auth = Buffer.from(encoded, "base64");
  if (auth.toString("base64") !== encoded) throw new ApiError(400, "Invalid X-Request-Auth");
  let requestAuth: BidStreamRequest["requestAuth"];
  try {
    requestAuth = ssz.gloas.SignedBuilderRequestAuth.deserialize(auth);
  } catch {
    throw new ApiError(400, "Invalid X-Request-Auth");
  }
  return {
    slot: integer(params.slot, "slot"),
    parentHash: bytes(params.parent_hash, 32, "parent hash"),
    parentRoot: bytes(params.parent_root, 32, "parent root"),
    proposerPubkey: bytes(params.proposer_pubkey, 48, "proposer public key"),
    requestAuth,
    dateMilliseconds: integer(request.headers["date-milliseconds"], "Date-Milliseconds"),
    timeoutMs: integer(request.headers["x-timeout-ms"], "X-Timeout-Ms"),
  };
}

function serveBidStream(
  socket: WebSocket,
  stream: RetainedBidStream,
  release: () => void,
  logger: Logger,
  admission: Admission,
  subscribeAbort: SubscribeAbort,
  adaptiveTiming: boolean
): void {
  const request = admission.request;
  const started = performance.now();
  const adaptiveDeadline = adaptiveTiming ? stream.hardDeadline : undefined;
  const hardDeadline = adaptiveDeadline?.monotonic ?? stream.deadline;
  const hardDeadlineUnixMs = adaptiveDeadline?.unixMs ?? Date.now() + Math.max(0, hardDeadline - started);
  let sendDeadline = Math.min(stream.deadline, hardDeadline);
  let sendDeadlineUnixMs = hardDeadlineUnixMs - (hardDeadline - sendDeadline);
  let stopped = false;
  let sending = false;
  let scheduled = false;
  let dirty = false;
  let lastFrame: Buffer | undefined;
  let lastOfferedBid: ReturnType<RetainedBidStream["current"]> = null;
  let updates = 0;
  let lastBid: {blockHash: string; valueGwei: number} | undefined;
  let roundTripMs: number | undefined;
  let terminateTimer: NodeJS.Timeout | undefined;
  let unsubscribe = (): void => {};
  let removeAbort = (): void => {};
  let clientPings = 0;
  let pongSending = false;
  let pendingPong: Buffer | undefined;
  const hardExpired = (): boolean => performance.now() >= hardDeadline || Date.now() >= hardDeadlineUnixMs;
  const sendExpired = (): boolean => performance.now() >= sendDeadline || Date.now() >= sendDeadlineUnixMs;
  const close = (code = 1000): void => {
    if (stopped) return;
    stopped = true;
    clearTimeout(deadlineTimer);
    clearInterval(eligibilityTimer);
    unsubscribe();
    removeAbort();
    socket.close(code);
    terminateTimer = setTimeout(() => socket.terminate(), CLOSE_GRACE_MS);
  };
  const abort = (): void => close(1001);
  const schedule = (): void => {
    dirty = true;
    if (scheduled || stopped || sending) return;
    scheduled = true;
    queueMicrotask(pump);
  };
  const pump = (): void => {
    scheduled = false;
    if (stopped || sending) return;
    dirty = false;
    if (hardExpired() || stream.signal?.aborted) {
      close();
      return;
    }
    if (sendExpired()) return;
    const bid = stream.current();
    if (!bid || bid === lastOfferedBid) return;
    try {
      const type = ssz.gloas.SignedExecutionPayloadBid;
      if (type.value_serializedSize(bid) + 2 > MAX_FRAME_BYTES) {
        close(1009);
        return;
      }
      const frame = Buffer.concat([Buffer.from([FRAME_VERSION, GLOAS_FORK]), type.serialize(bid)]);
      if (lastFrame?.equals(frame)) {
        lastOfferedBid = bid;
        return;
      }
      // Fastify's HTTP onSend guard does not run for WebSocket messages.
      if (sendExpired() || !stream.canOffer(bid) || socket.readyState !== WebSocket.OPEN) return;
      sending = true;
      socket.send(frame, {binary: true, compress: false}, (error) => {
        sending = false;
        if (error) return close(1011);
        if (dirty) schedule();
      });
      lastFrame = frame;
      lastOfferedBid = bid;
      lastBid = {blockHash: toHex(bid.message.blockHash), valueGwei: bid.message.value};
      updates++;
    } catch {
      close(1011);
    }
  };
  const ping = randomBytes(8);
  const pingStarted = performance.now();
  // Beyond the midpoint, a new pong's full RTT leaves no send time. Never shorten the initial
  // approved window merely because this probe is still pending.
  const probeDeadline = Math.max(sendDeadline, Math.min(hardDeadline, (hardDeadline + pingStarted) / 2));
  let deadlineTimer = setTimeout(close, Math.max(0, probeDeadline - performance.now()));
  // A constructor heartbeat can renew a retained bid's lease without adding a revision.
  // This only rereads local eligibility; it never asks the constructor to build or fetch.
  const eligibilityTimer = setInterval(schedule, ELIGIBILITY_RECHECK_MS);
  socket.on("message", () => close(1008));
  const flushPong = (): void => {
    if (stopped || pongSending || !pendingPong) return;
    const payload = pendingPong;
    pendingPong = undefined;
    pongSending = true;
    socket.pong(payload, false, (error) => {
      pongSending = false;
      if (error) close(1011);
      else flushPong();
    });
  };
  socket.on("ping", (payload: Buffer) => {
    if (stopped) return;
    if (++clientPings > MAX_CLIENT_PINGS || socket.bufferedAmount > MAX_FRAME_BYTES + 128) {
      close(1008);
      return;
    }
    pendingPong = payload;
    flushPong();
  });
  socket.once("close", () => {
    close();
    clearTimeout(terminateTimer);
    release();
    try {
      logger.info("Builder bid stream closed", {
        slot: request.slot,
        parentHash: toHex(request.parentHash),
        parentRoot: toHex(request.parentRoot),
        proposer: toHex(request.proposerPubkey),
        userAgent: admission.userAgent,
        timeoutMs: request.timeoutMs,
        adaptiveTiming: adaptiveDeadline !== undefined,
        transitMs: admission.transitMs,
        updates,
        ...lastBid,
        durationMs: Math.round(performance.now() - started),
        initialSendWindowMs: Math.max(0, Math.round(stream.deadline - started)),
        finalSendWindowMs: Math.max(0, Math.round(sendDeadline - started)),
        probeWindowMs: Math.max(0, Math.round(probeDeadline - started)),
        hardStopWindowMs: Math.max(0, Math.round(hardDeadline - started)),
        ...(roundTripMs !== undefined ? {roundTripMs: Math.round(roundTripMs)} : {}),
      });
    } catch {
      // Socket cleanup and capacity release must survive a diagnostic failure.
    }
  });
  removeAbort = subscribeAbort(stream.signal, abort);
  if (stopped) return;
  unsubscribe = stream.subscribe(schedule);
  pump();
  socket.on("pong", (payload: Buffer) => {
    if (stopped || roundTripMs !== undefined || !payload.equals(ping)) return;
    if (hardExpired()) return close();
    roundTripMs = performance.now() - pingStarted;
    if (!adaptiveDeadline) return;
    sendDeadline = hardDeadline - Math.ceil(roundTripMs);
    sendDeadlineUnixMs = hardDeadlineUnixMs - Math.ceil(roundTripMs);
    clearTimeout(deadlineTimer);
    if (sendExpired()) return close();
    deadlineTimer = setTimeout(close, Math.max(0, sendDeadline - performance.now()));
    schedule();
  });
  if (!stopped && socket.readyState === WebSocket.OPEN) socket.ping(ping);
}
