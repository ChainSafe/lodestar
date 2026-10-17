import {FastifyInstance, fastify} from "fastify";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {TimeoutError, defer} from "@lodestar/utils";
import {getExecutionEngineHttp} from "../../../src/execution/engine/index.js";
import {HttpRpcError} from "../../../src/execution/engine/jsonRpcHttpClient.js";
import {getMockedLogger} from "../../mocks/loggerMock.js";

const hash = `0x${"11".repeat(32)}`;
const transactions = ["0x010203", "0xaabb"];
const decodedTransactions = [Uint8Array.of(1, 2, 3), Uint8Array.of(0xaa, 0xbb)];

describe("ExecutionEngine / inclusion list", () => {
  let controller: AbortController;
  let servers: FastifyInstance[];
  let releases: (() => void)[];
  let requests: string[];

  beforeEach(() => {
    controller = new AbortController();
    servers = [];
    releases = [];
    requests = [];
  });

  afterEach(async () => {
    controller.abort();
    for (const release of releases) release();
    await Promise.all(servers.map((server) => server.close()));
  });

  async function startServer(name: string, fails = false) {
    const server = fastify({forceCloseConnections: true});
    servers.push(server);
    const started = defer<void>();
    const release = defer<void>();
    releases.push(release.resolve);
    server.post<{Body: {id: number; method: string}}>("/", async (req, reply) => {
      const {id, method} = req.body;
      if (method === "engine_getClientVersionV1") {
        return {jsonrpc: "2.0", id, result: [{code: "XX", name: "Test EL", version: "1", commit: "0x12345678"}]};
      }
      requests.push(`${name}: ${method}`);
      if (method === "engine_getInclusionListV1") {
        started.resolve();
        await release.promise;
        if (fails) return reply.code(500).send("Internal Server Error");
        return {jsonrpc: "2.0", id, result: transactions};
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {payloadStatus: {status: "VALID", latestValidHash: hash, validationError: null}, payloadId: null},
      };
    });
    const url = await server.listen({host: "127.0.0.1", port: 0});
    return {url, started: started.promise, release: release.resolve};
  }

  function createEngine(urls: string[]) {
    return getExecutionEngineHttp(
      {urls, engineApi: "json-rpc", retries: 2, retryDelay: 0, timeout: 500},
      {signal: controller.signal, logger: getMockedLogger()}
    );
  }

  it.each(["HTTP error", "timeout"] as const)(
    "does not retry an inclusion list after %s before processing a queued forkchoice update",
    async (failure) => {
      const server = await startServer("primary", true);
      const engine = createEngine([server.url]);
      const inclusionList = engine.getInclusionList();
      await server.started;
      const forkchoice = engine.notifyForkchoiceUpdate(ForkName.bellatrix, hash, hash, hash);
      const results = Promise.allSettled([inclusionList, forkchoice]);
      if (failure === "HTTP error") server.release();

      expect(await results).toEqual([
        {status: "rejected", reason: expect.any(failure === "HTTP error" ? HttpRpcError : TimeoutError)},
        {status: "fulfilled", value: null},
      ]);
      expect(requests).toEqual(["primary: engine_getInclusionListV1", "primary: engine_forkchoiceUpdatedV1"]);
    }
  );

  it("deserializes transactions from a successful inclusion list", async () => {
    const server = await startServer("primary");
    server.release();
    const engine = createEngine([server.url]);

    expect(await engine.getInclusionList()).toEqual(decodedTransactions);
    expect(requests).toEqual(["primary: engine_getInclusionListV1"]);
  });

  it("still falls back to another URL when the first inclusion list request fails", async () => {
    const primary = await startServer("primary", true);
    const fallback = await startServer("fallback");
    primary.release();
    fallback.release();
    const engine = createEngine([primary.url, fallback.url]);

    expect(await engine.getInclusionList()).toEqual(decodedTransactions);
    expect(requests).toEqual(["primary: engine_getInclusionListV1", "fallback: engine_getInclusionListV1"]);
  });
});
