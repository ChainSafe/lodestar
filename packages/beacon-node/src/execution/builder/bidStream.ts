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

type BidStreamRequest = {
  url: string;
  slot: Slot;
  parentHash: Root;
  parentRoot: Root;
  proposerPubkey: BLSPubkey;
  requestAuth: gloas.SignedBuilderRequestAuth;
  dateMilliseconds: number;
  timeoutMs: number;
  requestTimeoutMs: number;
  userAgent?: string;
  signal?: AbortSignal;
  /** Stop with a bid if one exists; otherwise retain the bounded in-flight fallback. */
  stopSignal?: AbortSignal;
  msFromSlot: () => number;
  onBid?: (bid: StreamedBuilderBid) => void;
};

export type BidStreamResult = {
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
  if (request.signal?.aborted || request.requestTimeoutMs <= 0) {
    return Promise.resolve({
      opened: false,
      updates: 0,
      discarded: 0,
      reason: request.signal?.aborted ? "aborted" : "deadline",
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
    let opened = false;
    let latest: StreamedBuilderBid | undefined;
    let lastFrame: Buffer | undefined;
    let updates = 0;
    let discarded = 0;
    let messages = 0;
    let pings = 0;
    let pongSending = false;
    let pendingPong: Buffer | undefined;
    const deadline = performance.now() + request.requestTimeoutMs;
    // autoPong is supported by the pinned ws version. Bound control writes as well as data reads.
    const options = {
      followRedirects: false,
      perMessageDeflate: false,
      maxPayload: MAX_FRAME_BYTES,
      autoPong: false,
      handshakeTimeout: request.requestTimeoutMs,
      headers: {
        "Eth-Consensus-Version": "gloas",
        "Date-Milliseconds": String(request.dateMilliseconds),
        "X-Timeout-Ms": String(request.timeoutMs),
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
      resolve({opened, bid: latest, updates, discarded, reason, statusCode});
    };
    const abort = (): void => finish("aborted");
    const stop = (): void => {
      if (latest) finish("aborted");
    };
    const expired = (): boolean => performance.now() >= deadline;
    const timer = setTimeout(() => finish("deadline"), request.requestTimeoutMs);
    socket.on("error", () => finish("error"));
    socket.once("open", () => {
      opened = true;
    });
    socket.once("close", () => finish("closed"));
    socket.once("unexpected-response", (_request, response) => {
      response.destroy();
      finish("http", response.statusCode);
    });
    socket.on("message", (data, isBinary) => {
      if (stopped) return;
      if (expired()) return finish("deadline");
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
