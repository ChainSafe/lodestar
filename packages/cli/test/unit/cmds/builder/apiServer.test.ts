import {afterEach, describe, expect, it, vi} from "vitest";
import {ApiError} from "@lodestar/api/server";
import {BuilderApi} from "@lodestar/builder";
import {config} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {LogLevel, toHex} from "@lodestar/utils";
import {BuilderRestApiServer, getBuilderApiBeforeInit} from "../../../../src/cmds/builder/apiServer.js";
import {testLogger} from "../../../utils.js";

class TestBuilderRestApiServer extends BuilderRestApiServer {
  inject: BuilderRestApiServer["server"]["inject"] = (...args: Parameters<BuilderRestApiServer["server"]["inject"]>) =>
    this.server.inject(...args);

  beforeSerialization(callback: () => void): void {
    this.server.addHook("preSerialization", async (_req, _reply, payload) => {
      callback();
      return payload;
    });
  }
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

  it("keeps the client deadline anchor even when edge timestamp headers are supplied", async () => {
    const received = vi.fn().mockResolvedValue({data: undefined, meta: {version: "gloas"}, status: 204});
    const root = toHex(Buffer.alloc(32));
    const clientStamp = Date.now() - 200;
    const res = await getServer({getExecutionPayloadBid: received}).inject({
      method: "POST",
      url: `/eth/v1/builder/execution_payload_bid/5/${root}/${root}/${toHex(Buffer.alloc(48))}`,
      headers: {
        "Eth-Consensus-Version": "gloas",
        "Date-Milliseconds": String(clientStamp),
        "X-Timeout-Ms": "400",
        "X-Edge-Received-Sec": String(Math.floor(Date.now() / 1000)),
        "X-Edge-Received-Msec": String(Date.now() % 1000),
      },
      payload: ssz.gloas.SignedBuilderRequestAuth.toJson(ssz.gloas.SignedBuilderRequestAuth.defaultValue()) as object,
    });
    expect(res.statusCode).toBe(204);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({dateMilliseconds: clientStamp}), expect.anything());
  });

  it("does not serve routes of earlier forks", async () => {
    const res = await getServer().inject({method: "POST", url: "/eth/v1/builder/validators", payload: []});

    expect(res.statusCode).toBe(404);
  });

  it("does not send a bid whose permission expires during response serialization", async () => {
    let allowed = true;
    const builder = getServer({
      getExecutionPayloadBid: async (_args, context) => {
        context?.setResponseGuard?.(() => allowed);
        return {data: ssz.gloas.SignedExecutionPayloadBid.defaultValue(), meta: {version: ForkName.gloas}};
      },
    });
    builder.beforeSerialization(() => {
      allowed = false;
    });
    const root = toHex(Buffer.alloc(32));
    const proposer = toHex(Buffer.alloc(48));
    const res = await builder.inject({
      method: "POST",
      url: `/eth/v1/builder/execution_payload_bid/5/${root}/${root}/${proposer}`,
      headers: {"Eth-Consensus-Version": "gloas", "Date-Milliseconds": String(Date.now()), "X-Timeout-Ms": "500"},
      payload: ssz.gloas.SignedBuilderRequestAuth.toJson(ssz.gloas.SignedBuilderRequestAuth.defaultValue()) as object,
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
    expect(res.headers["cache-control"]).toBe("no-store");
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
    expect(res.headers["cache-control"]).toBe("no-store");
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

  it("serves the status and no bids before the builder is initialized", async () => {
    const getExecutionPayloadBid = vi
      .fn()
      .mockResolvedValue({data: ssz.gloas.SignedExecutionPayloadBid.defaultValue(), meta: {version: "gloas"}});
    let builderApi: BuilderApi | null = null;
    server = new TestBuilderRestApiServer(
      {},
      {config, logger: testLogger(), metrics: null, api: getBuilderApiBeforeInit(config, () => builderApi)}
    );
    const root = toHex(Buffer.alloc(32, 2));
    const bidRequest = {
      method: "POST" as const,
      url: `/eth/v1/builder/execution_payload_bid/5/${root}/${root}/${toHex(Buffer.alloc(48, 1))}`,
      headers: {"Eth-Consensus-Version": "gloas", "Date-Milliseconds": String(Date.now()), "X-Timeout-Ms": "500"},
      payload: ssz.gloas.SignedBuilderRequestAuth.toJson(ssz.gloas.SignedBuilderRequestAuth.defaultValue()) as object,
    };

    expect((await server.inject({method: "GET", url: "/eth/v1/builder/status"})).statusCode).toBe(200);
    expect((await server.inject(bidRequest)).statusCode).toBe(204);
    const preferences = await server.inject({
      method: "POST",
      url: `/eth/v1/builder/builder_preferences/${toHex(Buffer.alloc(48, 1))}`,
      headers: {"Eth-Consensus-Version": "gloas"},
      payload: ssz.gloas.BuilderPreferencesRequest.toJson(ssz.gloas.BuilderPreferencesRequest.defaultValue()) as object,
    });
    expect(preferences.statusCode).toBe(503);

    builderApi = {
      status: vi.fn(),
      getExecutionPayloadBid,
      submitSignedBeaconBlock: vi.fn(),
      submitBuilderPreferences: vi.fn(),
    };

    expect((await server.inject(bidRequest)).statusCode).toBe(200);
    expect(getExecutionPayloadBid).toHaveBeenCalledOnce();
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
