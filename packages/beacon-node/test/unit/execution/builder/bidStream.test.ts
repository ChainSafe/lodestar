import {once} from "node:events";
import {IncomingMessage, Server, createServer} from "node:http";
import {Socket} from "node:net";
import {afterEach, describe, expect, it, vi} from "vitest";
import {WebSocket, WebSocketServer} from "ws";
import {gloas, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {StreamedBuilderBid, getExecutionPayloadBidStream} from "../../../../src/execution/builder/bidStream.js";

type StreamRequest = Parameters<typeof getExecutionPayloadBidStream>[0];
type TestServer = {http: Server; ws: WebSocketServer; sockets: Set<Socket>; url: string};

const slot = 123;
const parentHash = new Uint8Array(32).fill(1);
const parentRoot = new Uint8Array(32).fill(2);
const proposerPubkey = new Uint8Array(48).fill(3);
const servers: TestServer[] = [];

describe("execution/builder/bidStream", () => {
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

  it.each(["", "/private/builder/"])(
    "preserves the base path %j and sends exact request authentication",
    async (prefix) => {
      const server = await startServer();
      let received: IncomingMessage | undefined;
      server.ws.once("connection", (socket, request) => {
        received = request;
        socket.close();
      });
      const request = makeRequest(`${server.url}${prefix}?network=test#fragment`);
      const began = Date.now();
      const result = await getExecutionPayloadBidStream(request);

      expect(result).toMatchObject({upgraded: true, opened: true, reason: "closed", updates: 0, discarded: 0});
      expect(received?.url).toBe(
        `${prefix.replace(/\/$/, "")}/eth/v1/builder/execution_payload_bid_stream/${slot}/${toHex(parentHash)}/${toHex(parentRoot)}/${toHex(proposerPubkey)}?network=test`
      );
      expect(received?.headers).toMatchObject({
        "eth-consensus-version": "gloas",
        "x-request-auth": Buffer.from(ssz.gloas.SignedBuilderRequestAuth.serialize(request.requestAuth)).toString(
          "base64"
        ),
        "user-agent": request.userAgent,
      });
      expect(Number(received?.headers["date-milliseconds"])).toBeGreaterThanOrEqual(began);
      expect(Number(received?.headers["date-milliseconds"])).toBeLessThanOrEqual(Date.now());
      expect(Number(received?.headers["x-timeout-ms"])).toBeGreaterThan(0);
      expect(Number(received?.headers["x-timeout-ms"])).toBeLessThanOrEqual(request.timeoutMs);
      expect(received?.headers["sec-websocket-extensions"]).toBeUndefined();
    }
  );

  it("keeps the latest revision even when its value is lower", async () => {
    const server = await startServer();
    const earlier = makeBid(100, 4);
    const latest = makeBid(25, 5);
    server.ws.once("connection", (socket) => {
      socket.send(frame(earlier));
      socket.send(frame(latest));
      socket.close();
    });
    const msFromSlot = vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(200);
    const result = await getExecutionPayloadBidStream(makeRequest(server.url, {msFromSlot}));

    expect(result).toMatchObject({opened: true, reason: "closed", updates: 2, discarded: 0});
    expectBid(result.bid, latest, 200);
  });

  it("matches HTTP Basic authentication for percent-encoded URL credentials", async () => {
    const server = await startServer();
    let received: IncomingMessage | undefined;
    server.ws.once("connection", (socket, request) => {
      received = request;
      socket.close();
    });
    const url = new URL(server.url);
    url.username = "test%3Auser";
    url.password = "p%40ss%2Fword%3A%20ok";

    const result = await getExecutionPayloadBidStream(makeRequest(url.href));

    expect(result).toMatchObject({opened: true, reason: "closed"});
    expect(received?.headers.authorization).toBe(`Basic ${Buffer.from("test:user:p@ss/word: ok").toString("base64")}`);
    expect(received?.url).not.toContain("test%3Auser");
    expect(received?.url).not.toContain("p%40ss");
  });

  it("ignores text, malformed frames and every mismatched context without replacing the valid bid", async () => {
    const server = await startServer();
    const valid = makeBid();
    const invalidBids = [
      makeBidWith({slot: slot + 1}),
      makeBidWith({parentBlockHash: new Uint8Array(32).fill(9)}),
      makeBidWith({parentBlockRoot: new Uint8Array(32).fill(9)}),
      makeBidWith({blockHash: parentHash}),
    ];
    server.ws.once("connection", (socket) => {
      socket.send(frame(valid));
      socket.send(JSON.stringify({bid: "text frames are not accepted"}));
      socket.send(Buffer.alloc(0));
      socket.send(Buffer.from([1, 7, 0xff]));
      socket.send(Buffer.concat([Buffer.from([2, 7]), frame(valid).subarray(2)]));
      socket.send(Buffer.concat([Buffer.from([1, 6]), frame(valid).subarray(2)]));
      for (const bid of invalidBids) socket.send(frame(bid));
      socket.close();
    });

    const result = await getExecutionPayloadBidStream(makeRequest(server.url));

    expect(result).toMatchObject({opened: true, reason: "closed", updates: 1, discarded: 9});
    expectBid(result.bid, valid);
  });

  it("retains the original receipt time for duplicate frames, including after malformed input", async () => {
    const server = await startServer();
    const valid = makeBid();
    server.ws.once("connection", (socket) => {
      socket.send(frame(valid));
      socket.send(frame(valid));
      socket.send(Buffer.from([1, 7]));
      socket.send(frame(valid));
      socket.close();
    });
    let time = 0;
    const result = await getExecutionPayloadBidStream(makeRequest(server.url, {msFromSlot: () => ++time * 100}));

    expect(result).toMatchObject({updates: 1, discarded: 1, reason: "closed"});
    expectBid(result.bid, valid, 100);
  });

  it("ends an idle open stream at its absolute deadline and retains its latest bid", async () => {
    const server = await startServer();
    const valid = makeBid();
    server.ws.once("connection", (socket) => socket.send(frame(valid)));
    const started = performance.now();
    const result = await getExecutionPayloadBidStream(makeRequest(server.url, {requestTimeoutMs: 100}));

    expect(result).toMatchObject({opened: true, reason: "deadline", updates: 1});
    expectBid(result.bid, valid);
    expect(performance.now() - started).toBeGreaterThanOrEqual(75);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("keeps the caller's original absolute deadline instead of restarting it inside the helper", async () => {
    const server = await startServer();
    server.ws.once("connection", (socket) => socket.send(frame(makeBid())));
    const began = performance.now();
    const result = await getExecutionPayloadBidStream(
      makeRequest(server.url, {startedAt: began - 150, timeoutMs: 250, requestTimeoutMs: 250})
    );
    expect(result).toMatchObject({opened: true, reason: "deadline", updates: 1});
    expect(performance.now() - began).toBeLessThan(225);
  });

  it("bounds a handshake that never responds", async () => {
    const server = await startServer();
    server.http.removeAllListeners("upgrade");
    const requested = once(server.http, "upgrade");
    const started = performance.now();
    const resultPromise = getExecutionPayloadBidStream(makeRequest(server.url, {requestTimeoutMs: 100}));
    await requested;
    const result = await resultPromise;

    expect(result.opened).toBe(false);
    // Both the absolute deadline and ws's handshake timeout enforce the same bound.
    expect(["deadline", "error"]).toContain(result.reason);
    expect(result.bid).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("does not extend the absolute deadline when heartbeat traffic continues", async () => {
    const server = await startServer();
    let heartbeatCount = 0;
    server.ws.once("connection", (socket) => {
      const timer = setInterval(() => {
        heartbeatCount++;
        socket.ping(Buffer.from("still-alive"));
      }, 20);
      socket.once("close", () => clearInterval(timer));
    });
    const started = performance.now();

    const result = await getExecutionPayloadBidStream(makeRequest(server.url, {requestTimeoutMs: 150}));

    expect(result).toMatchObject({opened: true, reason: "deadline", updates: 0});
    expect(heartbeatCount).toBeGreaterThan(0);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("aborts an open stream and keeps the bid received before cancellation", async () => {
    const server = await startServer();
    const controller = new AbortController();
    const valid = makeBid();
    server.ws.once("connection", (socket) => afterBidReceived(socket, valid, () => controller.abort()));

    const result = await getExecutionPayloadBidStream(makeRequest(server.url, {signal: controller.signal}));

    expect(result).toMatchObject({opened: true, reason: "aborted", updates: 1});
    expectBid(result.bid, valid);
  });

  it("flushes the latest bid on soft stop without waiting for the connection deadline", async () => {
    const server = await startServer();
    const stop = new AbortController();
    const valid = makeBid();
    server.ws.once("connection", (socket) => afterBidReceived(socket, valid, () => stop.abort()));

    const result = await getExecutionPayloadBidStream(makeRequest(server.url, {stopSignal: stop.signal}));

    expect(result).toMatchObject({opened: true, reason: "aborted", updates: 1});
    expectBid(result.bid, valid);
  });

  it.each(["before-open", "after-open"] as const)(
    "after soft stop %s waits for the first context-valid bid instead of dropping the rescue",
    async (timing) => {
      const server = await startServer();
      const stop = new AbortController();
      if (timing === "before-open") stop.abort();
      const valid = makeBid();
      server.ws.once("connection", (socket) => {
        if (timing === "after-open") stop.abort();
        socket.send(frame(makeBidWith({slot: slot + 1})));
        socket.once("pong", () => socket.send(frame(valid)));
        socket.ping(Buffer.from("rescue-next"));
      });

      const result = await getExecutionPayloadBidStream(makeRequest(server.url, {stopSignal: stop.signal}));

      expect(result).toMatchObject({opened: true, reason: "aborted", updates: 1, discarded: 1});
      expectBid(result.bid, valid);
    }
  );

  it("keeps the original deadline when soft stop has no rescuing bid", async () => {
    const server = await startServer();
    const stop = new AbortController();
    stop.abort();
    const started = performance.now();

    const result = await getExecutionPayloadBidStream(
      makeRequest(server.url, {stopSignal: stop.signal, requestTimeoutMs: 100})
    );

    expect(result).toMatchObject({opened: true, reason: "deadline", updates: 0});
    expect(result.bid).toBeUndefined();
    expect(performance.now() - started).toBeGreaterThanOrEqual(75);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("settles an already aborted request without waiting for its deadline", async () => {
    const server = await startServer();
    const controller = new AbortController();
    controller.abort();
    const started = performance.now();

    const result = await getExecutionPayloadBidStream(makeRequest(server.url, {signal: controller.signal}));

    expect(result).toMatchObject({opened: false, reason: "aborted", updates: 0});
    expect(result.bid).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("does not open a connection when no request budget remains", async () => {
    const server = await startServer();
    const connected = vi.fn();
    server.http.on("connection", connected);

    const result = await getExecutionPayloadBidStream(makeRequest(server.url, {requestTimeoutMs: 0}));

    expect(result).toMatchObject({opened: false, reason: "deadline", updates: 0});
    expect(result.bid).toBeUndefined();
    expect(connected).not.toHaveBeenCalled();
  });

  it.each([403, 503])("settles a rejected HTTP upgrade with status %i", async (status) => {
    const server = await startServer();
    server.http.removeAllListeners("upgrade");
    server.http.on("upgrade", (_request, socket) => {
      socket.end(`HTTP/1.1 ${status} Rejected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    });

    const result = await getExecutionPayloadBidStream(makeRequest(server.url));

    expect(result).toMatchObject({upgraded: false, opened: false, reason: "http", statusCode: status, updates: 0});
    expect(result.bid).toBeUndefined();
  });

  it.each([
    ["invalid accept", "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: invalid\r\n", "error"],
    ["missing headers", "", "http"],
    ["connection close", "Connection: close\r\n", "http"],
  ])("records malformed HTTP101 with %s as upgraded but not opened", async (_name, headers, reason) => {
    const server = await startServer();
    server.http.removeAllListeners("upgrade");
    server.http.on("upgrade", (_request, socket) => {
      socket.end(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`);
    });

    const result = await getExecutionPayloadBidStream(makeRequest(server.url));

    expect(result).toMatchObject({upgraded: true, opened: false, reason, updates: 0});
    expect(result.bid).toBeUndefined();
  });

  it("does not follow redirects or forward request authentication to another origin", async () => {
    const redirectTarget = await startServer();
    const targetRequest = vi.fn();
    redirectTarget.http.on("request", targetRequest);
    redirectTarget.http.on("upgrade", targetRequest);
    const server = await startServer();
    server.http.removeAllListeners("upgrade");
    server.http.on("upgrade", (_request, socket) => {
      socket.end(
        `HTTP/1.1 302 Found\r\nLocation: ${redirectTarget.url}/leak\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
      );
    });

    const result = await getExecutionPayloadBidStream(makeRequest(server.url));

    expect(result).toMatchObject({opened: false, reason: "http", statusCode: 302});
    expect(targetRequest).not.toHaveBeenCalled();
  });

  it.each(["close", "reset"] as const)("retains the last bid when the peer performs %s", async (ending) => {
    const server = await startServer();
    const valid = makeBid();
    server.ws.once("connection", (socket) => {
      afterBidReceived(socket, valid, () => (ending === "close" ? socket.close() : socket.terminate()));
    });

    const result = await getExecutionPayloadBidStream(makeRequest(server.url));

    expect(result).toMatchObject({opened: true, reason: "closed", updates: 1});
    expectBid(result.bid, valid);
  });

  it("bounds oversized payloads while retaining the preceding valid bid", async () => {
    const server = await startServer();
    const valid = makeBid();
    server.ws.once("connection", (socket) => {
      afterBidReceived(socket, valid, () => socket.send(Buffer.alloc(1024 * 1024 + 1)));
    });

    const result = await getExecutionPayloadBidStream(makeRequest(server.url));

    expect(result).toMatchObject({opened: true, reason: "error", updates: 1});
    expectBid(result.bid, valid);
  });

  it("counts duplicate messages toward the 64-message limit before accepting another revision", async () => {
    const server = await startServer();
    const valid = makeBid();
    server.ws.once("connection", (socket) => {
      for (let i = 0; i < 64; i++) socket.send(frame(valid));
      socket.send(frame(makeBid(500, 5)));
    });
    const msFromSlot = vi.fn(() => 123);

    const result = await getExecutionPayloadBidStream(makeRequest(server.url, {msFromSlot}));

    expect(result).toMatchObject({opened: true, reason: "limit", updates: 1, discarded: 0});
    expectBid(result.bid, valid);
    expect(msFromSlot).toHaveBeenCalledTimes(64);
  });

  it("echoes ping payloads with pong without counting them as bid updates", async () => {
    const server = await startServer();
    const payload = Buffer.from("heartbeat");
    let receivedPong: Buffer | undefined;
    server.ws.once("connection", (socket) => {
      socket.once("pong", (data) => {
        receivedPong = data;
        socket.close();
      });
      socket.ping(payload);
    });

    const result = await getExecutionPayloadBidStream(makeRequest(server.url));

    expect(result).toMatchObject({opened: true, reason: "closed", updates: 0, discarded: 0});
    expect(receivedPong).toEqual(payload);
  });

  it("bounds control traffic at 32 pings and keeps the latest bid", async () => {
    const server = await startServer();
    const valid = makeBid();
    server.ws.once("connection", (socket) => {
      socket.send(frame(valid));
      for (let i = 0; i < 33; i++) socket.ping(Buffer.from([i]));
    });

    const result = await getExecutionPayloadBidStream(makeRequest(server.url));

    expect(result).toMatchObject({opened: true, reason: "limit", updates: 1, discarded: 0});
    expectBid(result.bid, valid);
  });

  it.each(["pong-only", "mixed"] as const)(
    "bounds %s control traffic using the shared 32-frame budget",
    async (kind) => {
      const server = await startServer();
      const valid = makeBid();
      server.ws.once("connection", (socket) => {
        socket.send(frame(valid));
        for (let i = 0; i < 33; i++) {
          if (kind === "mixed" && i % 2 === 0) socket.ping(Buffer.from([i]));
          else socket.pong(Buffer.from([i]));
        }
      });

      const result = await getExecutionPayloadBidStream(makeRequest(server.url));

      expect(result).toMatchObject({opened: true, reason: "limit", updates: 1, discarded: 0});
      expectBid(result.bid, valid);
    }
  );
});

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
  ws.on("connection", (socket) => socket.on("error", () => {}));
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

function makeRequest(url: string, overrides: Partial<StreamRequest> = {}): StreamRequest {
  const requestAuth = ssz.gloas.SignedBuilderRequestAuth.defaultValue();
  requestAuth.message.data = Uint8Array.from([1, 2, 3]);
  requestAuth.message.slot = slot;
  requestAuth.signature.fill(4);
  return {
    url,
    slot,
    parentHash,
    parentRoot,
    proposerPubkey,
    requestAuth,
    timeoutMs: 500,
    requestTimeoutMs: 2_000,
    userAgent: "lodestar-stream-test",
    msFromSlot: () => 123,
    ...overrides,
  };
}

function makeBid(value = 100, hashByte = 4): gloas.SignedExecutionPayloadBid {
  return makeBidWith({value, blockHash: new Uint8Array(32).fill(hashByte)});
}

function makeBidWith(fields: Partial<gloas.ExecutionPayloadBid>): gloas.SignedExecutionPayloadBid {
  const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  Object.assign(
    bid.message,
    {slot, parentBlockHash: parentHash, parentBlockRoot: parentRoot, blockHash: new Uint8Array(32).fill(4)},
    fields
  );
  return bid;
}

function frame(bid: gloas.SignedExecutionPayloadBid): Buffer {
  return Buffer.concat([Buffer.from([1, 7]), Buffer.from(ssz.gloas.SignedExecutionPayloadBid.serialize(bid))]);
}

/** The pong proves the client has processed the preceding bid, without sleeps or network polling. */
function afterBidReceived(socket: WebSocket, bid: gloas.SignedExecutionPayloadBid, callback: () => void): void {
  socket.once("pong", callback);
  socket.send(frame(bid));
  socket.ping(Buffer.from("bid-processed"));
}

function expectBid(
  actual: StreamedBuilderBid | undefined,
  expected: gloas.SignedExecutionPayloadBid,
  receivedMs?: number
): void {
  expect(actual).toBeDefined();
  if (!actual) throw Error("Expected a streamed bid");
  // SSZ decoding can retain Buffer slices; compare the full value independent of byte-array prototypes.
  expect(ssz.gloas.SignedExecutionPayloadBid.toJson(actual.signedBid)).toEqual(
    ssz.gloas.SignedExecutionPayloadBid.toJson(expected)
  );
  if (receivedMs !== undefined) expect(actual.receivedMs).toBe(receivedMs);
}
