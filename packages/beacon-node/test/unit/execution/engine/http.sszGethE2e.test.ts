import {readFileSync} from "node:fs";
import {afterEach, describe, expect, it, vi} from "vitest";
import {LODESTAR_ENGINE_SSZ_CAPABILITIES} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import * as lodestarUtils from "@lodestar/utils";
import {fromHex} from "@lodestar/utils";
import {ExecutionEngineHttp} from "../../../../src/execution/engine/http.js";
import {JsonRpcHttpClient} from "../../../../src/execution/engine/jsonRpcHttpClient.js";

const runE2e = process.env.ENGINE_SSZ_GETH_E2E === "1";
const describeE2e = runE2e ? describe : describe.skip;
const realFetch = lodestarUtils.fetch;

afterEach(() => {
  vi.restoreAllMocks();
});

function readJwtHex(): string {
  const path = process.env.ENGINE_SSZ_GETH_JWT ?? "/tmp/geth-jwt.hex";
  return readFileSync(path, "utf8").trim();
}

describeE2e("execution / engine / http.sszGethE2e", () => {
  const logger = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()} as any;

  it("negotiates SSZ endpoint support from geth method-name capability response", async () => {
    const jwtSecretHex = readJwtHex();
    const rpc = new JsonRpcHttpClient(["http://127.0.0.1:8551"], {
      jwtSecret: fromHex(jwtSecretHex),
      retries: 0,
      retryDelay: 0,
      timeout: 5000,
    });

    const engine = new ExecutionEngineHttp(
      rpc,
      {signal: new AbortController().signal, logger, metrics: null},
      {urls: ["http://127.0.0.1:8551"], retries: 0, retryDelay: 0, timeout: 5000, jwtSecretHex}
    );

    (engine as any).clientVersion = null;
    await engine.exchangeCapabilities(LODESTAR_ENGINE_SSZ_CAPABILITIES);

    const supported = (engine as any).sszNegotiation.getSupportedCapabilities();
    expect(supported).toContain("POST /engine/v1/client/version");
    expect(supported).toContain("POST /engine/v1/payloads/bodies/by-range");
    expect(supported).toContain("POST /engine/v1/payloads/bodies/by-hash");
    expect(supported.length).toBeGreaterThan(0);
  });

  it("attempts SSZ path, then falls back to JSON-RPC on live geth unsupported status", async () => {
    const jwtSecretHex = readJwtHex();
    const rpc = new JsonRpcHttpClient(["http://127.0.0.1:8551"], {
      jwtSecret: fromHex(jwtSecretHex),
      retries: 0,
      retryDelay: 0,
      timeout: 5000,
    });

    const engine = new ExecutionEngineHttp(
      rpc,
      {signal: new AbortController().signal, logger, metrics: null},
      {urls: ["http://127.0.0.1:8551"], retries: 0, retryDelay: 0, timeout: 5000, jwtSecretHex}
    );

    (engine as any).clientVersion = null;
    await engine.exchangeCapabilities(LODESTAR_ENGINE_SSZ_CAPABILITIES);

    const sszStatuses: number[] = [];
    const fetchSpy = vi.spyOn(lodestarUtils, "fetch").mockImplementation(async (...args: unknown[]) => {
      const res = await (realFetch as (...a: unknown[]) => Promise<Response>)(...args);
      if (String(args[0]).endsWith("/engine/v1/client/version")) {
        sszStatuses.push(res.status);
      }
      return res;
    });

    const fetchWithRetriesSpy = vi.spyOn(rpc, "fetchWithRetries");

    const versions = await engine.getClientVersion({
      code: "LS",
      name: "Lodestar",
      version: "e2e",
      commit: "deadbeef",
    });

    const sszCalls = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/engine/v1/client/version"));
    const clientVersionJsonCalls = fetchWithRetriesSpy.mock.calls.filter(
      ([payload]) => (payload as any).method === "engine_getClientVersionV1"
    );

    expect(versions.length).toBeGreaterThan(0);
    expect(sszCalls.length).toBeGreaterThan(0);
    expect(sszStatuses).toContain(404);
    expect(clientVersionJsonCalls.length).toBeGreaterThan(0);
  });

  it("attempts SSZ payload-bodies endpoint, then falls back to JSON-RPC on live geth unsupported status", async () => {
    const jwtSecretHex = readJwtHex();
    const rpc = new JsonRpcHttpClient(["http://127.0.0.1:8551"], {
      jwtSecret: fromHex(jwtSecretHex),
      retries: 0,
      retryDelay: 0,
      timeout: 5000,
    });

    const engine = new ExecutionEngineHttp(
      rpc,
      {signal: new AbortController().signal, logger, metrics: null},
      {urls: ["http://127.0.0.1:8551"], retries: 0, retryDelay: 0, timeout: 5000, jwtSecretHex}
    );

    (engine as any).clientVersion = null;
    await engine.exchangeCapabilities(LODESTAR_ENGINE_SSZ_CAPABILITIES);

    const sszStatuses: number[] = [];
    const fetchSpy = vi.spyOn(lodestarUtils, "fetch").mockImplementation(async (...args: unknown[]) => {
      const res = await (realFetch as (...a: unknown[]) => Promise<Response>)(...args);
      if (String(args[0]).endsWith("/engine/v1/payloads/bodies/by-range")) {
        sszStatuses.push(res.status);
      }
      return res;
    });

    const fetchWithRetriesSpy = vi.spyOn(rpc, "fetchWithRetries");

    const payloadBodies = await engine.getPayloadBodiesByRange(ForkName.deneb, 1, 1);

    const sszCalls = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/engine/v1/payloads/bodies/by-range"));
    const jsonCalls = fetchWithRetriesSpy.mock.calls.filter(
      ([payload]) => (payload as any).method === "engine_getPayloadBodiesByRangeV1"
    );

    expect(Array.isArray(payloadBodies)).toBe(true);
    expect(sszCalls.length).toBeGreaterThan(0);
    expect(sszStatuses).toContain(404);
    expect(jsonCalls.length).toBeGreaterThan(0);
  });

  it("attempts SSZ payload-bodies-by-hash endpoint, then falls back to JSON-RPC on live geth unsupported status", async () => {
    const jwtSecretHex = readJwtHex();
    const rpc = new JsonRpcHttpClient(["http://127.0.0.1:8551"], {
      jwtSecret: fromHex(jwtSecretHex),
      retries: 0,
      retryDelay: 0,
      timeout: 5000,
    });

    const engine = new ExecutionEngineHttp(
      rpc,
      {signal: new AbortController().signal, logger, metrics: null},
      {urls: ["http://127.0.0.1:8551"], retries: 0, retryDelay: 0, timeout: 5000, jwtSecretHex}
    );

    (engine as any).clientVersion = null;
    await engine.exchangeCapabilities(LODESTAR_ENGINE_SSZ_CAPABILITIES);

    const sszStatuses: number[] = [];
    const fetchSpy = vi.spyOn(lodestarUtils, "fetch").mockImplementation(async (...args: unknown[]) => {
      const res = await (realFetch as (...a: unknown[]) => Promise<Response>)(...args);
      if (String(args[0]).endsWith("/engine/v1/payloads/bodies/by-hash")) {
        sszStatuses.push(res.status);
      }
      return res;
    });

    const fetchWithRetriesSpy = vi.spyOn(rpc, "fetchWithRetries");

    const payloadBodies = await engine.getPayloadBodiesByHash(ForkName.deneb, [
      "0x0000000000000000000000000000000000000000000000000000000000000000",
    ]);

    const sszCalls = fetchSpy.mock.calls.filter(([url]) => String(url).endsWith("/engine/v1/payloads/bodies/by-hash"));
    const jsonCalls = fetchWithRetriesSpy.mock.calls.filter(
      ([payload]) => (payload as any).method === "engine_getPayloadBodiesByHashV1"
    );

    expect(Array.isArray(payloadBodies)).toBe(true);
    expect(sszCalls.length).toBeGreaterThan(0);
    expect(sszStatuses).toContain(404);
    expect(jsonCalls.length).toBeGreaterThan(0);
  });

  it("falls back to JSON-RPC when endpoint is not negotiated", async () => {
    const jwtSecretHex = readJwtHex();
    const rpc = new JsonRpcHttpClient(["http://127.0.0.1:8551"], {
      jwtSecret: fromHex(jwtSecretHex),
      retries: 0,
      retryDelay: 0,
      timeout: 5000,
    });

    const engine = new ExecutionEngineHttp(
      rpc,
      {signal: new AbortController().signal, logger, metrics: null},
      {urls: ["http://127.0.0.1:8551"], retries: 0, retryDelay: 0, timeout: 5000, jwtSecretHex}
    );

    (engine as any).clientVersion = null;
    (engine as any).sszNegotiation.updateFromElCapabilities([]);

    const fetchWithRetriesSpy = vi.spyOn(rpc, "fetchWithRetries");

    const versions = await engine.getClientVersion({
      code: "LS",
      name: "Lodestar",
      version: "e2e",
      commit: "deadbeef",
    });

    const clientVersionJsonCalls = fetchWithRetriesSpy.mock.calls.filter(
      ([payload]) => (payload as any).method === "engine_getClientVersionV1"
    );

    expect(versions.length).toBeGreaterThan(0);
    expect(clientVersionJsonCalls.length).toBeGreaterThan(0);
  });
});
