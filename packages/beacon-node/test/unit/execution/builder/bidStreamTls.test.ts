import {once} from "node:events";
import {readFileSync} from "node:fs";
import {Agent, Server, createServer} from "node:https";
import {Duplex} from "node:stream";
import {TLSSocket} from "node:tls";
import {afterEach, describe, expect, it} from "vitest";
import {WebSocketServer} from "ws";
import {gloas, ssz} from "@lodestar/types";
import {getExecutionPayloadBidStream} from "../../../../src/execution/builder/bidStream.js";

type StreamRequest = Parameters<typeof getExecutionPayloadBidStream>[0];
type TestServer = {
  https: Server;
  ws: WebSocketServer;
  sockets: Set<Duplex>;
  connections: Array<{socket: TLSSocket; reused: boolean; protocol: string | null}>;
  url: string;
};

// Public, loopback-only test credentials with fixed validity from 2020 through 2120.
const cert = readFileSync(new URL("./fixtures/bid-stream-localhost-cert.pem", import.meta.url));
const key = readFileSync(new URL("./fixtures/bid-stream-localhost-key.pem", import.meta.url));
const slot = 123;
const parentHash = new Uint8Array(32).fill(1);
const parentRoot = new Uint8Array(32).fill(2);
const proposerPubkey = new Uint8Array(48).fill(3);
const servers: TestServer[] = [];
const agents: Agent[] = [];

describe("execution/builder/bidStream TLS", () => {
  afterEach(async () => {
    for (const agent of agents.splice(0)) agent.destroy();
    for (const server of servers.splice(0)) {
      for (const socket of server.ws.clients) socket.terminate();
      for (const socket of server.sockets) socket.destroy();
      await Promise.all([
        new Promise<void>((resolve) => server.ws.close(() => resolve())),
        new Promise<void>((resolve, reject) => server.https.close((error) => (error ? reject(error) : resolve()))),
      ]);
    }
  });

  it.each([true, false])("resumes a TLS session only when the agent is shared: %s", async (shared) => {
    const server = await startServer();
    const firstBid = makeBid(10, 4);
    const secondBid = makeBid(20, 5);
    const bids = [firstBid, secondBid];
    let offered = 0;
    server.ws.on("connection", (socket) => {
      socket.send(frame(bids[offered++]));
      socket.close();
    });
    const firstAgent = createAgent(true);
    const first = await getExecutionPayloadBidStream(makeRequest(server.url, firstAgent));
    const second = await getExecutionPayloadBidStream(makeRequest(server.url, shared ? firstAgent : createAgent(true)));

    for (const [index, result] of [first, second].entries()) {
      expect(result, `stream ${index}`).toMatchObject({opened: true, reason: "closed", updates: 1, discarded: 0});
      expect(result.bid, `stream ${index}`).toBeDefined();
      if (!result.bid) throw Error("Expected a streamed bid");
      expect(ssz.gloas.SignedExecutionPayloadBid.toJson(result.bid.signedBid), `stream ${index}`).toEqual(
        ssz.gloas.SignedExecutionPayloadBid.toJson(bids[index])
      );
    }
    expect(server.connections).toHaveLength(2);
    expect(server.connections[0].socket).not.toBe(server.connections[1].socket);
    expect(server.connections.map((connection) => connection.protocol)).toEqual(["TLSv1.2", "TLSv1.2"]);
    expect(server.connections.map((connection) => connection.reused)).toEqual([false, shared]);
  });

  it("rejects an untrusted certificate before HTTP upgrade or bid delivery", async () => {
    const server = await startServer();
    let upgraded = false;
    server.ws.on("connection", (socket) => {
      upgraded = true;
      socket.send(frame(makeBid(10, 4)));
      socket.close();
    });

    const result = await getExecutionPayloadBidStream(makeRequest(server.url, createAgent(false)));

    expect(result).toMatchObject({upgraded: false, opened: false, reason: "error", updates: 0, discarded: 0});
    expect(result.bid).toBeUndefined();
    expect(upgraded).toBe(false);
  });
});

function createAgent(trustFixture: boolean): Agent {
  const agent = new Agent({
    keepAlive: true,
    maxSockets: 64,
    maxTotalSockets: 64,
    maxFreeSockets: 16,
    maxCachedSessions: 64,
    ...(trustFixture ? {ca: cert} : {}),
  });
  agents.push(agent);
  return agent;
}

async function startServer(): Promise<TestServer> {
  const https = createServer({key, cert, minVersion: "TLSv1.2", maxVersion: "TLSv1.2"}, (_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const sockets = new Set<Duplex>();
  const connections: TestServer["connections"] = [];
  https.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  });
  https.on("secureConnection", (socket) => {
    connections.push({socket, reused: socket.isSessionReused(), protocol: socket.getProtocol()});
  });
  const ws = new WebSocketServer({noServer: true, perMessageDeflate: false});
  ws.on("connection", (socket) => socket.on("error", () => {}));
  https.on("upgrade", (request, socket, head) => {
    ws.handleUpgrade(request, socket, head, (client) => ws.emit("connection", client, request));
  });
  https.listen(0, "127.0.0.1");
  await once(https, "listening");
  const address = https.address();
  if (!address || typeof address === "string") throw Error("Expected a TCP listener");
  const server = {https, ws, sockets, connections, url: `https://127.0.0.1:${address.port}`};
  servers.push(server);
  return server;
}

function makeRequest(url: string, agent: Agent): StreamRequest {
  const requestAuth = ssz.gloas.SignedBuilderRequestAuth.defaultValue();
  requestAuth.message.slot = slot;
  return {
    url,
    slot,
    parentHash,
    parentRoot,
    proposerPubkey,
    requestAuth,
    agent,
    dateMilliseconds: 1_792_317_600_000,
    timeoutMs: 500,
    requestTimeoutMs: 2_000,
    msFromSlot: () => 123,
  };
}

function makeBid(value: number, hashByte: number): gloas.SignedExecutionPayloadBid {
  const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  Object.assign(bid.message, {
    slot,
    parentBlockHash: parentHash,
    parentBlockRoot: parentRoot,
    blockHash: new Uint8Array(32).fill(hashByte),
    value,
  });
  return bid;
}

function frame(bid: gloas.SignedExecutionPayloadBid): Buffer {
  return Buffer.concat([Buffer.from([1, 7]), Buffer.from(ssz.gloas.SignedExecutionPayloadBid.serialize(bid))]);
}
