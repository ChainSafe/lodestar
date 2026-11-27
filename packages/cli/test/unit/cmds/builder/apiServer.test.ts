import {afterEach, describe, expect, it, vi} from "vitest";
import {ApiError} from "@lodestar/api/server";
import {BuilderApi} from "@lodestar/builder";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {LogLevel, toHex} from "@lodestar/utils";
import {BuilderRestApiServer} from "../../../../src/cmds/builder/apiServer.js";
import {testLogger} from "../../../utils.js";

class TestBuilderRestApiServer extends BuilderRestApiServer {
  inject: BuilderRestApiServer["server"]["inject"] = (...args: Parameters<BuilderRestApiServer["server"]["inject"]>) =>
    this.server.inject(...args);
}

describe("cmds / builder / api server", () => {
  let server: TestBuilderRestApiServer | undefined;

  afterEach(async () => {
    await server?.close();
  });

  function getServer(api: Partial<BuilderApi> = {}): TestBuilderRestApiServer {
    server = new TestBuilderRestApiServer(
      {},
      {
        config,
        logger: testLogger(),
        metrics: null,
        api: {
          status: vi.fn(),
          getExecutionPayloadBid: vi.fn(),
          submitSignedBeaconBlock: vi.fn(),
          submitBuilderPreferences: vi.fn(),
          ...api,
        },
      }
    );
    return server;
  }

  it("serves the builder status", async () => {
    const res = await getServer().inject({method: "GET", url: "/eth/v1/builder/status"});

    expect(res.statusCode).toBe(200);
  });

  it("does not serve routes of earlier forks", async () => {
    const res = await getServer().inject({method: "POST", url: "/eth/v1/builder/validators", payload: []});

    expect(res.statusCode).toBe(404);
  });

  it("logs a bid request with the details of the caller", async () => {
    const logger = testLogger();
    const info = vi.spyOn(logger, LogLevel.info);
    const proposer = toHex(Buffer.alloc(48, 1));
    const root = toHex(Buffer.alloc(32, 2));
    server = new TestBuilderRestApiServer(
      {},
      {
        config,
        logger,
        metrics: null,
        api: {
          status: vi.fn(),
          getExecutionPayloadBid: vi.fn().mockResolvedValue({data: undefined, meta: {version: "gloas"}, status: 204}),
          submitSignedBeaconBlock: vi.fn(),
          submitBuilderPreferences: vi.fn(),
        },
      }
    );

    const res = await server.inject({
      method: "POST",
      url: `/eth/v1/builder/execution_payload_bid/5/${root}/${root}/${proposer}`,
      headers: {
        "Eth-Consensus-Version": "gloas",
        "Date-Milliseconds": String(Date.now() - 40),
        "X-Timeout-Ms": "500",
        "User-Agent": "Lodestar/v1.0.0",
        "X-Forwarded-For": "203.0.113.7, 10.0.0.1",
      },
      payload: ssz.gloas.SignedBuilderRequestAuth.toJson(ssz.gloas.SignedBuilderRequestAuth.defaultValue()) as object,
    });

    expect(res.statusCode).toBe(204);
    expect(info).toHaveBeenCalledWith(
      "Builder API request",
      expect.objectContaining({
        operationId: "getExecutionPayloadBid",
        status: 204,
        slot: 5,
        proposer,
        userAgent: "Lodestar/v1.0.0",
        ip: "203.0.113.7",
        timeoutMs: "500",
      })
    );
    const context = info.mock.calls.find(([message]) => message === "Builder API request")?.[1] as Record<
      string,
      unknown
    >;
    expect(context.transitMs).toBeGreaterThanOrEqual(40);
  });

  it("only logs the fields a request has", async () => {
    const logger = testLogger();
    const info = vi.spyOn(logger, LogLevel.info);
    server = new TestBuilderRestApiServer(
      {},
      {
        config,
        logger,
        metrics: null,
        api: {
          status: vi.fn(),
          getExecutionPayloadBid: vi.fn(),
          submitSignedBeaconBlock: vi.fn().mockResolvedValue({status: 202}),
          submitBuilderPreferences: vi.fn(),
        },
      }
    );

    const res = await server.inject({
      method: "POST",
      url: "/eth/v1/builder/beacon_blocks",
      headers: {"Eth-Consensus-Version": "gloas", "User-Agent": "Lodestar/v1.0.0"},
      payload: ssz.gloas.SignedBeaconBlock.toJson(ssz.gloas.SignedBeaconBlock.defaultValue()) as object,
    });

    expect(res.statusCode).toBe(202);
    const context = info.mock.calls.find(([message]) => message === "Builder API request")?.[1] as Record<
      string,
      unknown
    >;
    expect(Object.keys(context).sort()).toEqual(["durationMs", "ip", "operationId", "status", "userAgent"]);
  });

  it("returns the status code of a rejected request", async () => {
    const submitBuilderPreferences = vi.fn().mockRejectedValue(new ApiError(401, "signature verification failed"));

    const res = await getServer({submitBuilderPreferences}).inject({
      method: "POST",
      url: `/eth/v1/builder/builder_preferences/${toHex(Buffer.alloc(48, 1))}`,
      headers: {"Eth-Consensus-Version": "gloas"},
      payload: ssz.gloas.BuilderPreferencesRequest.toJson(ssz.gloas.BuilderPreferencesRequest.defaultValue()) as object,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({code: 401, message: "signature verification failed"});
    expect(submitBuilderPreferences).toHaveBeenCalledOnce();
  });
});
