import {once} from "node:events";
import {IncomingMessage, Server, createServer} from "node:http";
import {Socket} from "node:net";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {WebSocket, WebSocketServer} from "ws";
import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {ErrorAborted, TimeoutError, toHex} from "@lodestar/utils";
import type {IBlsVerifier} from "../../../../src/chain/bls/index.js";
import {
  BUILDER_BID_LAG_BUFFER_MS,
  BuilderApiClient,
  BuilderApiClientOpts,
} from "../../../../src/execution/builder/apiClient.js";
import {IClock} from "../../../../src/util/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

const {getClient, getExecutionPayloadBid, submitSignedBeaconBlock, verifySignatureSets} = vi.hoisted(() => ({
  getClient: vi.fn(),
  getExecutionPayloadBid: vi.fn(),
  submitSignedBeaconBlock: vi.fn(),
  verifySignatureSets: vi.fn(),
}));

vi.mock("@lodestar/api/builder", () => ({getClient}));

const bls = {
  verifySignatureSets,
  verifySignatureSetsSameMessage: vi.fn(),
  close: vi.fn(),
  canAcceptWork: vi.fn(),
} satisfies IBlsVerifier;
const slot = 123;
const parentHash = new Uint8Array(32).fill(1);
const parentRoot = new Uint8Array(32).fill(2);
const proposerPubkey = new Uint8Array(48).fill(3);
type TestServer = {http: Server; ws: WebSocketServer; sockets: Set<Socket>; url: string};
const servers: TestServer[] = [];

describe("execution/builder/apiClient stream integration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    verifySignatureSets.mockResolvedValue(true);
    getExecutionPayloadBid.mockResolvedValue({value: () => makeBid()});
    submitSignedBeaconBlock.mockResolvedValue({assertOk: vi.fn()});
    getClient.mockReturnValue({getExecutionPayloadBid, submitSignedBeaconBlock});
  });

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      for (const socket of server.ws.clients) socket.terminate();
      for (const socket of server.sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => server.ws.close(() => resolve())),
        new Promise<void>((resolve, reject) => server.http.close((error) => (error ? reject(error) : resolve()))),
      ]);
    }
  });

  it("uses HTTP with its existing timeout budget when streaming is not enabled", async () => {
    const server = await startServer();
    const connected = vi.fn();
    server.ws.on("connection", connected);
    const client = makeClient({bidStream: undefined, bidDeadline: 123});

    const bids = await collect(client, [entry(server.url)]);

    expect(bids).toHaveLength(1);
    expect(connected).not.toHaveBeenCalled();
    expect(getExecutionPayloadBid).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({slot, parentHash, parentRoot, proposerPubkey, timeoutMs: 123}),
      {timeoutMs: 123 + BUILDER_BID_LAG_BUFFER_MS, signal: expect.any(AbortSignal), redirect: "manual"}
    );
  });

  it("records configured HTTP budgets and decoded receipt without exposing URL credentials", async () => {
    const logger = getMockedLogger();
    const client = makeClient({bidStream: false, bidDeadline: 123}, {logger});
    const bids = await collect(client, [
      entry("https://private-user:private-password@builder.example.test/path?secret=hidden"),
    ]);
    const events = timingEvents(logger);
    const started = events.find((event) => event.event === "started");
    const dispatched = events.find((event) => event.event === "http_dispatch");
    const decoded = events.find((event) => event.event === "http_decoded");

    expect(bids).toHaveLength(1);
    expect(events).toHaveLength(3);
    expect(new Set(events.map((event) => event.attempt)).size).toBe(1);
    expect(Number(started?.advertisedBudgetDeadlineAtMs) - Number(started?.startedAtMs)).toBeCloseTo(123, 5);
    expect(Number(started?.clientBudgetDeadlineAtMs) - Number(started?.startedAtMs)).toBeCloseTo(373, 5);
    expect(dispatched).toMatchObject({timeoutMs: 123, requestTimeoutMs: 373, builder: "https://builder.example.test"});
    expect(decoded).toMatchObject({blockHash: toHex(makeBid().message.blockHash), receivedMs: bids[0].receivedMs});
    expect(Number(decoded?.dispatchBudgetSlackMs)).toBeCloseTo(
      Number(dispatched?.atMs) + 123 - Number(decoded?.atMs),
      5
    );
    const serialized = JSON.stringify(events);
    for (const secret of ["private-user", "private-password", "hidden", "requestAuth", "signature"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("records negative advertised slack without changing the HTTP lag-buffer acceptance", async () => {
    const logger = getMockedLogger();
    getExecutionPayloadBid.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({value: () => makeBid()}), 40))
    );
    const bids = await collect(makeClient({bidStream: false, bidDeadline: 10}, {logger}), [
      entry("https://builder.test"),
    ]);
    const decoded = timingEvents(logger).find((event) => event.event === "http_decoded");

    expect(bids).toHaveLength(1);
    expect(Number(decoded?.advertisedBudgetSlackMs)).toBeLessThan(0);
    expect(Number(decoded?.clientBudgetSlackMs)).toBeGreaterThan(0);
  });

  it("ignores timing logger failures while collecting HTTP bids", async () => {
    const logger = getMockedLogger();
    logger.debug.mockImplementation((message) => {
      if (message === "Builder bid request timing") throw Error("diagnostic sink failed");
    });
    const bids = await collect(makeClient({bidStream: false}, {logger}), [entry("https://builder.test")]);

    expect(bids).toHaveLength(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([ErrorAborted, TimeoutError])(
    "records %s failures without their message and preserves rejection",
    async (ErrorType) => {
      const logger = getMockedLogger();
      const error = new ErrorType("sensitive request details");
      getExecutionPayloadBid.mockRejectedValue(error);

      const bids = await collect(makeClient({bidStream: false}, {logger}), [entry("https://builder.test")]);
      const failed = timingEvents(logger).find((event) => event.event === "http_failed");

      expect(bids).toEqual([]);
      expect(failed).toMatchObject({errorName: ErrorType.name, aborted: false});
      expect(JSON.stringify(failed)).not.toContain("sensitive request details");
      expect(logger.warn).toHaveBeenCalledWith(
        "Failed to get bid from builder",
        {slot, builder: "https://builder.test"},
        error
      );
    }
  );

  it("retains an HTTP error status when decoding its rejected response", async () => {
    const logger = getMockedLogger();
    getExecutionPayloadBid.mockResolvedValue({
      status: 503,
      value: () => {
        throw Error("private error body");
      },
    });

    const bids = await collect(makeClient({bidStream: false}, {logger}), [entry("https://builder.test")]);
    const failed = timingEvents(logger).find((event) => event.event === "http_failed");

    expect(bids).toEqual([]);
    expect(failed).toMatchObject({statusCode: 503, errorName: "Error"});
    expect(JSON.stringify(failed)).not.toContain("private error body");
  });

  it.each([ForkName.fulu, ForkName.heze])("uses HTTP on %s even when streaming is enabled", async (fork) => {
    const server = await startServer();
    const connected = vi.fn();
    server.ws.on("connection", connected);
    const client = makeClient({}, {fork});

    const bids = await collect(client, [entry(server.url)]);

    expect(bids).toHaveLength(1);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(connected).not.toHaveBeenCalled();
  });

  it("authenticates a successful stream and registers its HTTP client for signed block submission", async () => {
    const server = await startServer();
    const offered = makeBid();
    server.ws.once("connection", (socket) => {
      socket.send(frame(offered));
      socket.close();
    });
    const client = makeClient({userAgent: "test-stream-client"});

    const bids = await collect(client, [entry(server.url)]);
    const signedBlock = {data: ssz.gloas.SignedBeaconBlock.defaultValue()};
    await client.submitSignedBeaconBlock(server.url, signedBlock);

    expect(bids).toHaveLength(1);
    expectBid(bids[0].signedBid, offered);
    expect(verifySignatureSets).toHaveBeenCalledOnce();
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
    expect(getClient).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        baseUrl: server.url,
        globalInit: {timeoutMs: undefined, redirect: "manual", headers: {"User-Agent": "test-stream-client"}},
      }),
      expect.any(Object)
    );
    expect(submitSignedBeaconBlock).toHaveBeenCalledExactlyOnceWith({signedBlock}, {redirect: "manual"});
  });

  it("does not dial a stream or register a client when request authentication fails", async () => {
    const server = await startServer();
    const connected = vi.fn();
    server.ws.on("connection", connected);
    verifySignatureSets.mockResolvedValue(false);

    const bids = await collect(makeClient(), [entry(server.url)]);

    expect(bids).toEqual([]);
    expect(connected).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("falls back before upgrade with only the remaining budget and a fresh date header", async () => {
    const server = await startServer();
    let streamRequest: IncomingMessage | undefined;
    server.http.removeAllListeners("upgrade");
    server.http.on("upgrade", (request, socket) => {
      streamRequest = request;
      setTimeout(() => socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"), 25);
    });
    const logger = getMockedLogger();
    const client = makeClient({bidDeadline: 200}, {logger});

    const bids = await collect(client, [entry(server.url)]);

    expect(bids).toHaveLength(1);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
    const [request, options] = getExecutionPayloadBid.mock.calls[0];
    expect(Number(streamRequest?.headers["x-timeout-ms"])).toBeGreaterThan(0);
    expect(Number(streamRequest?.headers["x-timeout-ms"])).toBeLessThanOrEqual(200);
    expect(request.timeoutMs).toBeGreaterThan(0);
    expect(request.timeoutMs).toBeLessThanOrEqual(180);
    expect(options.timeoutMs).toBe(request.timeoutMs + BUILDER_BID_LAG_BUFFER_MS);
    expect(options.redirect).toBe("manual");
    expect(request.dateMilliseconds).toBeGreaterThan(Number(streamRequest?.headers["date-milliseconds"]));
    expect(request.requestAuth).toEqual(entry(server.url).auth);
    const events = timingEvents(logger);
    expect(new Set(events.map((event) => event.attempt)).size).toBe(1);
    expect(events.find((event) => event.event === "websocket_headers_queued")).toMatchObject({
      timeoutMs: Number(streamRequest?.headers["x-timeout-ms"]),
      dateMilliseconds: Number(streamRequest?.headers["date-milliseconds"]),
    });
    expect(events.find((event) => event.event === "websocket_finished")).toMatchObject({
      reason: "http",
      statusCode: 404,
    });
    expect(events.find((event) => event.event === "http_fallback")).toMatchObject({
      timeoutMs: request.timeoutMs,
      requestTimeoutMs: options.timeoutMs,
    });
    expect(events.find((event) => event.event === "http_decoded")).toMatchObject({
      blockHash: toHex(bids[0].signedBid.message.blockHash),
    });
  });

  it.each([false, true])("never falls back to HTTP after upgrade, with a bid present: %s", async (hasBid) => {
    const server = await startServer();
    server.ws.once("connection", (socket) => {
      if (hasBid) socket.send(frame(makeBid()));
      socket.close();
    });

    const bids = await collect(makeClient(), [entry(server.url)]);

    expect(bids).toHaveLength(hasBid ? 1 : 0);
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid accept", "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: invalid\r\n"],
    ["missing headers", ""],
    ["connection close", "Connection: close\r\n"],
  ])("does not fall back after malformed HTTP101 with %s", async (_name, headers) => {
    const server = await startServer();
    server.http.removeAllListeners("upgrade");
    server.http.on("upgrade", (_request, socket) => {
      socket.end(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`);
    });

    const bids = await collect(makeClient(), [entry(server.url)]);

    expect(bids).toEqual([]);
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "does not follow an authenticated HTTP bid redirect, with streaming enabled: %s",
    async (bidStream) => {
      const actual = await vi.importActual<typeof import("@lodestar/api/builder")>("@lodestar/api/builder");
      getClient.mockImplementation(actual.getClient);
      const target = await startServer();
      const targetRequest = vi.fn();
      target.http.on("request", targetRequest);
      target.http.on("upgrade", targetRequest);
      const server = await startServer();
      const upgradeRequest = vi.fn();
      server.http.removeAllListeners("upgrade");
      server.http.on("upgrade", (request, socket) => {
        upgradeRequest(request);
        socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      });
      const bidRequest = vi.fn();
      server.http.removeAllListeners("request");
      server.http.on("request", (request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          bidRequest({method: request.method, body: Buffer.concat(chunks)});
          response.writeHead(307, {Location: `${target.url}/untrusted`});
          response.end();
        });
      });
      const builderEntry = entry(server.url);

      const bids = await collect(makeClient({bidStream}), [builderEntry]);

      expect(bids).toEqual([]);
      expect(upgradeRequest).toHaveBeenCalledTimes(bidStream ? 1 : 0);
      expect(bidRequest).toHaveBeenCalledExactlyOnceWith({
        method: "POST",
        body: Buffer.from(ssz.gloas.SignedBuilderRequestAuth.serialize(builderEntry.auth)),
      });
      expect(targetRequest).not.toHaveBeenCalled();
    }
  );

  it("does not follow a preferences redirect carrying signed request authentication", async () => {
    const actual = await vi.importActual<typeof import("@lodestar/api/builder")>("@lodestar/api/builder");
    getClient.mockImplementation(actual.getClient);
    const target = await startServer();
    const targetRequest = vi.fn();
    target.http.on("request", targetRequest);
    target.http.on("upgrade", targetRequest);
    const server = await startServer();
    const preferencesRequest = vi.fn();
    server.http.removeAllListeners("request");
    server.http.on("request", (request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        preferencesRequest({method: request.method, body: Buffer.concat(chunks)});
        response.writeHead(307, {Location: `${target.url}/untrusted`});
        response.end();
      });
    });
    const request: gloas.BuilderPreferencesRequest = {
      auth: entry(server.url).auth,
      preferences: {maxExecutionPayment: 100n},
    };

    await expect(makeClient().submitBuilderPreferences(server.url, proposerPubkey, request)).rejects.toMatchObject({
      status: 307,
    });

    expect(preferencesRequest).toHaveBeenCalledExactlyOnceWith({
      method: "POST",
      body: Buffer.from(ssz.gloas.BuilderPreferencesRequest.serialize(request)),
    });
    expect(targetRequest).not.toHaveBeenCalled();
  });

  it("does not restart the HTTP budget after an unresponsive upgrade consumes the round", async () => {
    const server = await startServer();
    server.http.removeAllListeners("upgrade");
    server.http.on("upgrade", () => {});
    const client = makeClient({bidDeadline: 30});

    const bids = await collect(client, [entry(server.url)]);

    expect(bids).toEqual([]);
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("returns the latest lower bid with its frame receipt time and ignores a later wrong context", async () => {
    const server = await startServer();
    let receiptMs = 0;
    const earlier = makeBid(100, 4);
    const latest = makeBid(25, 5);
    const wrong = makeBid(999, 6);
    wrong.message.parentBlockRoot = new Uint8Array(32).fill(9);
    server.ws.once("connection", (socket) => {
      receiptMs = 100;
      socket.send(frame(earlier));
      socket.once("pong", () => {
        receiptMs = 200;
        socket.send(frame(latest));
        socket.once("pong", () => {
          receiptMs = 300;
          socket.send(frame(wrong));
          socket.close();
        });
        socket.ping(Buffer.from("second"));
      });
      socket.ping(Buffer.from("first"));
    });
    const client = makeClient({}, {msFromSlot: () => receiptMs});

    const bids = await collect(client, [entry(server.url)]);

    expect(bids).toHaveLength(1);
    expectBid(bids[0].signedBid, latest);
    expect(bids[0].receivedMs).toBe(200);
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("preserves scheduled rounds and deduplicates unchanged signatures and duplicate entries", async () => {
    const server = await startServer();
    const rounds = [makeBid(100, 4), makeBid(25, 5), makeBid(25, 5)];
    const requestedAt: number[] = [];
    const advertised: string[] = [];
    server.ws.on("connection", (socket, request) => {
      const index = requestedAt.length;
      requestedAt.push(performance.now());
      advertised.push(String(request.headers["x-timeout-ms"]));
      socket.send(frame(rounds[index]));
      socket.close();
    });
    const client = makeClient({bidDeadline: 30, bidRequests: 3});
    const requestEntry = entry(server.url);

    const bids = await collect(client, [requestEntry, requestEntry]);

    expect(bids.map(({signedBid}) => signedBid.message.value)).toEqual([100, 25]);
    expect(requestedAt).toHaveLength(3);
    expect(requestedAt[2] - requestedAt[0]).toBeGreaterThanOrEqual(35);
    expect(advertised).toHaveLength(3);
    for (const [index, budget] of advertised.entries()) {
      expect(Number(budget), `round ${index} remaining budget`).toBeGreaterThan(0);
      expect(Number(budget), `round ${index} original budget`).toBeLessThanOrEqual(30);
    }
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("soft stop flushes an in-flight bid and prevents future scheduled rounds", async () => {
    const server = await startServer();
    const stop = new AbortController();
    let connections = 0;
    server.ws.on("connection", (socket) => {
      connections++;
      socket.send(frame(makeBid()));
      socket.once("pong", () => stop.abort());
      socket.ping(Buffer.from("bid-received"));
    });
    const logger = getMockedLogger();
    logger.debug.mockImplementation((message) => {
      if (message === "Builder bid request timing") throw Error("diagnostic sink failed");
    });
    const client = makeClient({bidDeadline: 200, bidRequests: 3}, {logger});

    const bids = await collect(client, [entry(server.url)], stop.signal);

    expect(bids).toHaveLength(1);
    expect(connections).toBe(1);
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
    const stops = timingEvents(logger).filter((event) => event.event === "collection_stopped");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({slot, candidates: 1, atMs: expect.any(Number)});
  });

  it("records an already stopped collection while retaining its existing first-round rescue", async () => {
    const logger = getMockedLogger();
    const stop = new AbortController();
    stop.abort();
    const bids = await collect(makeClient({bidStream: false}, {logger}), [entry("https://builder.test")], stop.signal);

    expect(bids).toHaveLength(1);
    expect(timingEvents(logger).filter((event) => event.event === "collection_stopped")).toEqual([
      expect.objectContaining({slot, candidates: 0, atMs: expect.any(Number)}),
    ]);
  });

  it("soft stop without a bid awaits the first valid in-flight rescue and cancels later rounds", async () => {
    const server = await startServer();
    const stop = new AbortController();
    let connections = 0;
    server.ws.on("connection", (socket) => {
      connections++;
      stop.abort();
      const invalid = makeBid();
      invalid.message.slot++;
      socket.send(frame(invalid));
      socket.once("pong", () => socket.send(frame(makeBid())));
      socket.ping(Buffer.from("rescue-next"));
    });
    const client = makeClient({bidDeadline: 200, bidRequests: 3});

    const bids = await collect(client, [entry(server.url)], stop.signal);

    expect(bids).toHaveLength(1);
    expect(bids[0].signedBid.message.slot).toBe(slot);
    expect(connections).toBe(1);
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
  });

  it("deduplicates overlapping rounds using the earliest frame receipt, not stream completion", async () => {
    const server = await startServer();
    let receiptMs = 0;
    let firstSocket: WebSocket | undefined;
    const sameBid = makeBid();
    server.ws.on("connection", (socket) => {
      if (!firstSocket) {
        firstSocket = socket;
        receiptMs = 100;
        socket.send(frame(sameBid));
      } else {
        receiptMs = 200;
        socket.send(frame(sameBid));
        socket.once("close", () => firstSocket?.close());
        socket.close();
      }
    });
    const client = makeClient({bidDeadline: 30, bidRequests: 2}, {msFromSlot: () => receiptMs});

    const bids = await collect(client, [entry(server.url)]);

    expect(bids).toHaveLength(1);
    expect(bids[0].receivedMs).toBe(100);
  });

  it("includes the newer in-flight revision flushed by soft stop when an earlier round already returned", async () => {
    const server = await startServer();
    const stop = new AbortController();
    let connections = 0;
    server.ws.on("connection", (socket) => {
      connections++;
      if (connections === 1) {
        socket.send(frame(makeBid(10, 4)));
        socket.close();
      } else {
        socket.send(frame(makeBid(100, 5)));
        socket.once("pong", () => stop.abort());
        socket.ping(Buffer.from("newer-bid-received"));
      }
    });
    const client = makeClient({bidDeadline: 30, bidRequests: 3});

    const bids = await collect(client, [entry(server.url)], stop.signal);

    expect(connections).toBe(2);
    expect(bids.map(({signedBid}) => signedBid.message.value)).toEqual([10, 100]);
  });

  it("hard shutdown terminates an empty stream and scheduled rounds without fallback or rescue wait", async () => {
    const server = await startServer();
    const shutdown = new AbortController();
    server.ws.once("connection", () => shutdown.abort());
    const client = makeClient({bidDeadline: 500, bidRequests: 3}, {shutdown: shutdown.signal});
    const started = performance.now();

    const bids = await collect(client, [entry(server.url)]);

    expect(bids).toEqual([]);
    expect(getExecutionPayloadBid).not.toHaveBeenCalled();
    expect(performance.now() - started).toBeLessThan(400);
  });

  it("passes hard shutdown through to an in-flight HTTP fallback", async () => {
    const server = await startServer();
    const shutdown = new AbortController();
    let abortedFallback = false;
    server.http.removeAllListeners("upgrade");
    server.http.on("upgrade", (_request, socket) => {
      socket.end("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
    });
    getExecutionPayloadBid.mockImplementation((_request, options: {signal?: AbortSignal}) => {
      if (!options.signal) return Promise.reject(Error("HTTP fallback has no hard shutdown signal"));
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener(
          "abort",
          () => {
            abortedFallback = true;
            reject(Error("shutdown"));
          },
          {once: true}
        );
        shutdown.abort();
      });
    });
    const client = makeClient({}, {shutdown: shutdown.signal});

    const bids = await collect(client, [entry(server.url)]);

    expect(bids).toEqual([]);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(abortedFallback).toBe(true);
  });

  it("shares the 64-stream limit across concurrent calls and sends overflow through HTTP", async () => {
    const server = await startServer();
    let connections = 0;
    server.ws.on("connection", (socket) => {
      connections++;
      socket.send(frame(makeBid()));
      socket.close();
    });
    const client = makeClient({bidDeadline: 2_000});
    const entries = Array.from({length: 65}, (_, i) => entry(server.url, i + 1));

    const [first, second] = await Promise.all([
      collect(client, entries.slice(0, 33)),
      collect(client, entries.slice(33)),
    ]);

    expect(connections).toBe(64);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
    expect(first.length + second.length).toBe(65);
    // Completed streams release the per-client reservation for the next call.
    await collect(client, [entries[0]]);
    expect(connections).toBe(65);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
  });
});

function makeClient(
  opts: BuilderApiClientOpts = {},
  {
    fork = ForkName.gloas,
    msFromSlot,
    shutdown,
    logger = getMockedLogger(),
  }: {
    fork?: ForkName;
    msFromSlot?: () => number;
    shutdown?: AbortSignal;
    logger?: ReturnType<typeof getMockedLogger>;
  } = {}
): BuilderApiClient {
  const started = performance.now();
  const clock = {msFromSlot: msFromSlot ?? (() => performance.now() - started)} as unknown as IClock;
  const config: ChainForkConfig = {...defaultConfig, getForkName: () => fork};
  return new BuilderApiClient({bidStream: true, ...opts}, config, clock, bls, null, logger, shutdown);
}

function timingEvents(logger: ReturnType<typeof getMockedLogger>) {
  return logger.debug.mock.calls
    .filter(([message]) => message === "Builder bid request timing")
    .map(([, context]) => {
      if (context === null || typeof context !== "object" || Array.isArray(context))
        throw Error("Expected timing fields");
      return context;
    });
}

function collect(client: BuilderApiClient, entries: routes.validator.BuilderEntry[], stopSignal?: AbortSignal) {
  return client.getExecutionPayloadBids(entries, slot, parentHash, parentRoot, proposerPubkey, stopSignal);
}

function entry(url: string, authId = 1): routes.validator.BuilderEntry {
  const auth = ssz.gloas.SignedBuilderRequestAuth.defaultValue();
  auth.message.slot = slot;
  auth.message.data = new Uint8Array([authId]);
  return {
    url: new TextEncoder().encode(url),
    auth,
    builderPubkeys: [],
    maxExecutionPayment: 0n,
    minBid: 0n,
    builderBoostFactor: 100n,
  };
}

function makeBid(value = 100, hashByte = 4): gloas.SignedExecutionPayloadBid {
  const signedBid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  Object.assign(signedBid.message, {
    slot,
    parentBlockHash: parentHash,
    parentBlockRoot: parentRoot,
    blockHash: new Uint8Array(32).fill(hashByte),
    value,
  });
  signedBid.signature.fill(hashByte);
  return signedBid;
}

function frame(bid: gloas.SignedExecutionPayloadBid): Buffer {
  return Buffer.concat([Buffer.from([1, 7]), Buffer.from(ssz.gloas.SignedExecutionPayloadBid.serialize(bid))]);
}

function expectBid(actual: gloas.SignedExecutionPayloadBid, expected: gloas.SignedExecutionPayloadBid): void {
  expect(ssz.gloas.SignedExecutionPayloadBid.toJson(actual)).toEqual(
    ssz.gloas.SignedExecutionPayloadBid.toJson(expected)
  );
}

async function startServer(): Promise<TestServer> {
  const http = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const sockets = new Set<Socket>();
  http.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  const ws = new WebSocketServer({noServer: true, perMessageDeflate: false});
  ws.on("connection", (socket: WebSocket) => socket.on("error", () => {}));
  http.on("upgrade", (request, socket, head) => {
    ws.handleUpgrade(request, socket, head, (client) => ws.emit("connection", client, request));
  });
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address();
  if (!address || typeof address === "string") throw Error("Expected a TCP listener");
  const server = {http, ws, sockets, url: `http://127.0.0.1:${address.port}`};
  servers.push(server);
  return server;
}
