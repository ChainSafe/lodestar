import {ClientRequest} from "node:http";
import {Agent} from "node:https";
import {Socket} from "node:net";
import {TLSSocket} from "node:tls";
import {WebSocket} from "ws";
import {BLSPubkey, Root, Slot, gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toHex} from "@lodestar/utils";

const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_MESSAGES = 64;
const MAX_PINGS = 32;
const FRAME_VERSION = 1;
const GLOAS_FORK = 7;

export type StreamedBuilderBid = {
  signedBid: gloas.SignedExecutionPayloadBid;
  receivedMs: number;
};

export type BidStreamTiming = {
  event: "headers_queued" | "upgrade" | "frame" | "finished";
  atMs: number;
  receivedMs?: number;
  timeoutMs?: number;
  dateMilliseconds?: number;
  blockHash?: string;
  reason?: BidStreamResult["reason"];
  statusCode?: number;
};

type BidStreamRequest = {
  url: string;
  slot: Slot;
  parentHash: Root;
  parentRoot: Root;
  proposerPubkey: BLSPubkey;
  requestAuth: gloas.SignedBuilderRequestAuth;
  startedAt?: number;
  timeoutMs: number;
  requestTimeoutMs: number;
  userAgent?: string;
  agent?: Agent;
  signal?: AbortSignal;
  /** Stop with a bid if one exists; otherwise retain the bounded in-flight fallback. */
  stopSignal?: AbortSignal;
  msFromSlot: () => number;
  onBid?: (bid: StreamedBuilderBid) => void;
  onTiming?: (timing: BidStreamTiming) => void;
};

export type BidStreamResult = {
  upgraded: boolean;
  opened: boolean;
  bid?: StreamedBuilderBid;
  updates: number;
  discarded: number;
  reason: "closed" | "deadline" | "aborted" | "error" | "http" | "limit";
  statusCode?: number;
};

/**
 * Keep only the latest context-matching revision, including a lower replacement. The caller
 * must run the normal builder bid validation before selecting it. There is no per-frame BLS work.
 */
export function getExecutionPayloadBidStream(request: BidStreamRequest): Promise<BidStreamResult> {
  const startedAt = request.startedAt ?? performance.now();
  const deadline = startedAt + request.requestTimeoutMs;
  const notifyTiming = (timing: BidStreamTiming): void => {
    try {
      request.onTiming?.(timing);
    } catch {
      // Diagnostics must not change transport or bid selection.
    }
  };
  if (request.signal?.aborted || performance.now() >= deadline) {
    const reason = request.signal?.aborted ? "aborted" : "deadline";
    notifyTiming({event: "finished", atMs: performance.now(), reason});
    return Promise.resolve({
      upgraded: false,
      opened: false,
      updates: 0,
      discarded: 0,
      reason,
    });
  }
  const url = new URL(request.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/$/, "")}/eth/v1/builder/execution_payload_bid_stream/${request.slot}/${toHex(request.parentHash)}/${toHex(request.parentRoot)}/${toHex(request.proposerPubkey)}`;
  url.hash = "";
  const authorization =
    url.username || url.password
      ? `Basic ${Buffer.from(decodeURIComponent(`${url.username}:${url.password}`)).toString("base64")}`
      : undefined;
  url.username = "";
  url.password = "";

  return new Promise((resolve) => {
    let stopped = false;
    let upgraded = false;
    let opened = false;
    let latest: StreamedBuilderBid | undefined;
    let lastFrame: Buffer | undefined;
    let updates = 0;
    let discarded = 0;
    let messages = 0;
    let pings = 0;
    let pongSending = false;
    let pendingPong: Buffer | undefined;
    // autoPong is supported by the pinned ws version. Bound control writes as well as data reads.
    const options = {
      followRedirects: false,
      perMessageDeflate: false,
      maxPayload: MAX_FRAME_BYTES,
      autoPong: false,
      handshakeTimeout: Math.max(1, Math.ceil(deadline - performance.now())),
      agent: request.agent,
      finishRequest(httpRequest: ClientRequest) {
        let ended = false;
        const send = (): void => {
          if (ended) return;
          ended = true;
          if (stopped || request.signal?.aborted) {
            httpRequest.destroy();
            return;
          }
          const queuedAt = performance.now();
          const remaining = Math.floor(request.timeoutMs - (queuedAt - startedAt));
          if (remaining <= 0 || performance.now() >= deadline) {
            finish("deadline");
            return;
          }
          // Charge setup once; only the HTTP transit is doubled by the builder's reply reserve.
          const dateMilliseconds = Date.now();
          httpRequest.setHeader("Date-Milliseconds", String(dateMilliseconds));
          httpRequest.setHeader("X-Timeout-Ms", String(remaining));
          httpRequest.end();
          notifyTiming({event: "headers_queued", atMs: queuedAt, timeoutMs: remaining, dateMilliseconds});
        };
        const onSocket = (connection: Socket): void => {
          // Direct queue handoff of a connected socket may leave reusedSocket=false.
          const tlsReady =
            connection instanceof TLSSocket && (connection.authorized || connection.authorizationError != null);
          if (url.protocol === "wss:" && !tlsReady) connection.once("secureConnect", send);
          else if (connection.connecting) connection.once("connect", send);
          else queueMicrotask(send);
        };
        if (httpRequest.socket) onSocket(httpRequest.socket);
        else httpRequest.once("socket", onSocket);
      },
      headers: {
        "Eth-Consensus-Version": "gloas",
        "X-Request-Auth": Buffer.from(ssz.gloas.SignedBuilderRequestAuth.serialize(request.requestAuth)).toString(
          "base64"
        ),
        ...(request.userAgent ? {"User-Agent": request.userAgent} : {}),
        ...(authorization ? {Authorization: authorization} : {}),
      },
    };
    const socket = new WebSocket(url, options);
    const finish = (reason: BidStreamResult["reason"], statusCode?: number): void => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", abort);
      request.stopSignal?.removeEventListener("abort", stop);
      pendingPong = undefined;
      socket.terminate();
      resolve({upgraded, opened, bid: latest, updates, discarded, reason, statusCode});
      notifyTiming({event: "finished", atMs: performance.now(), reason, statusCode});
    };
    const abort = (): void => finish("aborted");
    const stop = (): void => {
      if (latest) finish("aborted");
    };
    const expired = (): boolean => performance.now() >= deadline;
    const timer = setTimeout(() => finish("deadline"), Math.max(0, deadline - performance.now()));
    socket.on("error", () => finish("error"));
    socket.once("upgrade", () => {
      upgraded = true;
      notifyTiming({event: "upgrade", atMs: performance.now()});
    });
    socket.once("open", () => {
      opened = true;
    });
    socket.once("close", () => finish("closed"));
    socket.once("unexpected-response", (_request, response) => {
      if (response.statusCode === 101) upgraded = true;
      response.destroy();
      finish("http", response.statusCode);
    });
    socket.on("message", (data, isBinary) => {
      if (stopped) return;
      const receivedAt = performance.now();
      if (receivedAt >= deadline) return finish("deadline");
      if (++messages > MAX_MESSAGES) return finish("limit");
      const receivedMs = request.msFromSlot();
      const frame = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (!isBinary || frame[0] !== FRAME_VERSION || frame[1] !== GLOAS_FORK) {
        discarded++;
        return;
      }
      if (lastFrame?.equals(frame)) return;
      try {
        const signedBid = ssz.gloas.SignedExecutionPayloadBid.deserialize(frame.subarray(2));
        const bid = signedBid.message;
        if (
          bid.slot !== request.slot ||
          !byteArrayEquals(bid.parentBlockHash, request.parentHash) ||
          !byteArrayEquals(bid.parentBlockRoot, request.parentRoot) ||
          byteArrayEquals(bid.blockHash, request.parentHash)
        ) {
          discarded++;
          return;
        }
        latest = {signedBid, receivedMs};
        lastFrame = frame;
        updates++;
        request.onBid?.(latest);
        notifyTiming({event: "frame", atMs: receivedAt, receivedMs, blockHash: toHex(bid.blockHash)});
        if (request.stopSignal?.aborted) stop();
      } catch {
        discarded++;
      }
    });
    const flushPong = (): void => {
      if (stopped || pongSending || !pendingPong) return;
      const payload = pendingPong;
      pendingPong = undefined;
      pongSending = true;
      socket.pong(payload, true, (error) => {
        pongSending = false;
        if (error) finish("error");
        else flushPong();
      });
    };
    socket.on("ping", (payload: Buffer) => {
      if (stopped) return;
      if (expired()) return finish("deadline");
      if (++pings > MAX_PINGS || socket.bufferedAmount > MAX_FRAME_BYTES) return finish("limit");
      pendingPong = payload;
      flushPong();
    });
    socket.on("pong", () => {
      if (!stopped && ++pings > MAX_PINGS) finish("limit");
    });
    request.signal?.addEventListener("abort", abort, {once: true});
    request.stopSignal?.addEventListener("abort", stop, {once: true});
    if (request.signal?.aborted) abort();
  });
}
