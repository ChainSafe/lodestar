import {afterEach, describe, expect, it, vi} from "vitest";
import {ByteListType, ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import * as lodestarUtils from "@lodestar/utils";
import {ExecutionEngineHttp} from "../../../../src/execution/engine/http.js";
import type {IJsonRpcHttpClient} from "../../../../src/execution/engine/jsonRpcHttpClient.js";
import {JsonRpcHttpClientEventEmitter} from "../../../../src/execution/engine/jsonRpcHttpClient.js";

class StubRpcClient implements IJsonRpcHttpClient {
  emitter = new JsonRpcHttpClientEventEmitter();
  fetch = vi.fn();
  fetchWithRetries = vi.fn();
  fetchBatch = vi.fn();
}

const executionPayloadBodyV1Type = new ContainerType(
  {
    transactions: new ListCompositeType(new ByteListType(1024), 16),
    withdrawals: new ListCompositeType(ssz.capella.Withdrawal, 16),
  },
  {typeName: "EngineExecutionPayloadBodyV1Test"}
);

const nullableExecutionPayloadBodyV1Type = new ListCompositeType(executionPayloadBodyV1Type, 1);
const payloadBodiesV1ResponseType = new ContainerType(
  {
    payloadBodies: new ListCompositeType(nullableExecutionPayloadBodyV1Type, 32),
  },
  {typeName: "EnginePayloadBodiesV1ResponseTest"}
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("execution / engine / http.sszFallback", () => {
  it("uses negotiated SSZ endpoint and skips JSON-RPC", async () => {
    const rpc = new StubRpcClient();
    const logger = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()} as any;

    const engine = new ExecutionEngineHttp(
      rpc,
      {signal: new AbortController().signal, logger, metrics: null},
      {urls: ["http://localhost:8551"], retries: 0, retryDelay: 0}
    );

    (engine as any).sszNegotiation.updateFromElCapabilities(["POST /engine/v1/payloads/bodies/by-range"]);

    const sszResponseBytes = payloadBodiesV1ResponseType.serialize({
      payloadBodies: [
        [
          {
            transactions: [Uint8Array.from([0xaa, 0xbb])],
            withdrawals: [],
          },
        ],
      ],
    });

    const fetchSpy = vi.spyOn(lodestarUtils, "fetch").mockResolvedValue(
      new Response(sszResponseBytes, {
        status: 200,
        headers: {"content-type": "application/octet-stream"},
      })
    );

    const res = await engine.getPayloadBodiesByRange(ForkName.deneb, 10, 1);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rpc.fetchWithRetries).not.toHaveBeenCalled();
    expect(res).toEqual([{transactions: [Uint8Array.from([0xaa, 0xbb])], withdrawals: []}]);
  });

  it.each([404, 415, 501])("falls back to JSON-RPC on unsupported SSZ status %s", async (statusCode) => {
    const rpc = new StubRpcClient();
    const logger = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()} as any;
    rpc.fetchWithRetries.mockResolvedValue([{transactions: ["0xaabb"], withdrawals: []}]);
    const engine = new ExecutionEngineHttp(
      rpc,
      {signal: new AbortController().signal, logger, metrics: null},
      {urls: ["http://localhost:8551"], retries: 0, retryDelay: 0}
    );
    (engine as any).sszNegotiation.updateFromElCapabilities(["POST /engine/v1/payloads/bodies/by-range"]);
    const fetchSpy = vi
      .spyOn(lodestarUtils, "fetch")
      .mockResolvedValue(new Response("unsupported", {status: statusCode, statusText: "Unsupported"}));
    const res = await engine.getPayloadBodiesByRange(ForkName.deneb, 10, 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rpc.fetchWithRetries).toHaveBeenCalledTimes(1);
    expect(res).toEqual([{transactions: [Uint8Array.from([0xaa, 0xbb])], withdrawals: []}]);
  });

  it("does not fallback to JSON-RPC on non-unsupported SSZ server status", async () => {
    const rpc = new StubRpcClient();
    const logger = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()} as any;

    const engine = new ExecutionEngineHttp(
      rpc,
      {signal: new AbortController().signal, logger, metrics: null},
      {urls: ["http://localhost:8551"], retries: 0, retryDelay: 0}
    );

    (engine as any).sszNegotiation.updateFromElCapabilities(["POST /engine/v1/payloads/bodies/by-range"]);

    const fetchSpy = vi.spyOn(lodestarUtils, "fetch").mockResolvedValue(
      new Response("server error", {
        status: 500,
        statusText: "Internal Server Error",
      })
    );

    await expect(engine.getPayloadBodiesByRange(ForkName.deneb, 10, 1)).rejects.toThrow("Internal Server Error");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rpc.fetchWithRetries).not.toHaveBeenCalled();
  });

  it("uses JSON-RPC directly when endpoint is not negotiated", async () => {
    const rpc = new StubRpcClient();
    const logger = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn()} as any;

    rpc.fetchWithRetries.mockResolvedValue([{transactions: ["0x01"], withdrawals: []}]);

    const engine = new ExecutionEngineHttp(
      rpc,
      {signal: new AbortController().signal, logger, metrics: null},
      {urls: ["http://localhost:8551"], retries: 0, retryDelay: 0}
    );

    const fetchSpy = vi.spyOn(lodestarUtils, "fetch");

    const res = await engine.getPayloadBodiesByRange(ForkName.deneb, 10, 1);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rpc.fetchWithRetries).toHaveBeenCalledTimes(1);
    expect(res).toEqual([{transactions: [Uint8Array.from([1])], withdrawals: []}]);
  });
});
