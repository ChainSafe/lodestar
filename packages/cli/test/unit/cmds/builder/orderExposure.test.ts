import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {OrderExposure} from "@lodestar/builder";
import {config} from "@lodestar/config/default";
import {BuilderRestApiServer} from "../../../../src/cmds/builder/apiServer.js";
import {testLogger} from "../../../utils.js";

class Server extends BuilderRestApiServer {
  inject: BuilderRestApiServer["server"]["inject"] = (...args: Parameters<BuilderRestApiServer["server"]["inject"]>) =>
    this.server.inject(...args);
}

const directories: string[] = [];
let server: Server | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
  for (const directory of directories.splice(0)) fs.rmSync(directory, {recursive: true, force: true});
});

function setup(enabled = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "exposure-api-"));
  directories.push(directory);
  const token = "ab".repeat(32);
  const filename = path.join(directory, "token");
  fs.writeFileSync(filename, `${token}\n`, {mode: 0o600});
  const exposure = new OrderExposure([]);
  const capability = {
    version: 1 as const,
    publisherInstance: "12345678-1234-4234-8234-123456789012",
    ready: true,
    coverageSinceUnixMs: 1,
    observedAtUnixMs: 2,
  };
  const capabilities = vi.spyOn(exposure, "capabilities").mockReturnValue(capability);
  const query = vi.spyOn(exposure, "query").mockImplementation(async (request) => ({
    version: 1,
    orderId: request.orderId,
    namespace: request.namespace,
    generation: request.generation,
    publisherInstance: capability.publisherInstance,
    observedAtUnixMs: Date.now(),
    barrierComplete: true,
    coverageComplete: true,
    priorCommitmentExposure: "none",
    earliestPossibleOfferAtUnixMs: null,
    commitmentCount: 0,
    commitments: [],
    truncated: false,
  }));
  server = new Server(
    {orderExposureTokenFile: enabled ? filename : undefined},
    {
      config,
      logger: testLogger(),
      metrics: null,
      api: {
        status: vi.fn(),
        getExecutionPayloadBid: vi.fn(),
        submitSignedBeaconBlock: vi.fn(),
        submitBuilderPreferences: vi.fn(),
      },
      getOrderExposure: () => exposure,
    }
  );
  const payload = {
    version: 1,
    action: "query",
    orderId: `0x${"12".repeat(32)}`,
    namespace: `0x${"34".repeat(16)}`,
    generation: "0x1",
    admittedAtUnixMs: 2,
    admittedPublisherInstance: capability.publisherInstance,
  };
  return {server, token, filename, capabilities, query, payload};
}

describe("private order exposure API", () => {
  it.each([undefined, "Bearer wrong", `Bearer ${"AB".repeat(32)}`])(
    "rejects an unauthorized request: %s",
    async (authorization) => {
      const m = setup();
      const response = await m.server.inject({
        method: "POST",
        url: "/internal/v1/order-exposure",
        headers: authorization ? {authorization} : {},
        payload: m.payload,
      });
      expect(response.statusCode).toBe(401);
      expect(m.capabilities).not.toHaveBeenCalled();
      expect(m.query).not.toHaveBeenCalled();
      expect(response.body).not.toContain(m.token);
    }
  );

  it("serves capabilities and bound queries only with the configured token", async () => {
    const m = setup();
    fs.unlinkSync(m.filename);
    const headers = {authorization: `Bearer ${m.token}`};
    const capabilities = await m.server.inject({
      method: "POST",
      url: "/internal/v1/order-exposure",
      headers,
      payload: {version: 1, action: "capabilities"},
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toMatchObject({ready: true, observedAtUnixMs: 2});
    const response = await m.server.inject({
      method: "POST",
      url: "/internal/v1/order-exposure",
      headers,
      payload: m.payload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      orderId: m.payload.orderId,
      namespace: m.payload.namespace,
      generation: "0x1",
    });
    expect(m.query).toHaveBeenCalledWith(m.payload);
  });

  it.each([{orderId: "0x12"}, {generation: "0x00"}, {namespace: "0x1"}, {admittedAtUnixMs: -1}, {extra: true}])(
    "rejects malformed query fields: %j",
    async (changed) => {
      const m = setup();
      const response = await m.server.inject({
        method: "POST",
        url: "/internal/v1/order-exposure",
        headers: {authorization: `Bearer ${m.token}`},
        payload: {...m.payload, ...changed},
      });
      expect(response.statusCode).toBe(400);
      expect(m.query).not.toHaveBeenCalled();
    }
  );

  it("has no endpoint without the opt-in token file", async () => {
    const m = setup(false);
    const response = await m.server.inject({method: "POST", url: "/internal/v1/order-exposure", payload: m.payload});
    expect(response.statusCode).toBe(404);
  });

  it("rejects an oversized authenticated request before querying a journal", async () => {
    const m = setup();
    const response = await m.server.inject({
      method: "POST",
      url: "/internal/v1/order-exposure",
      headers: {authorization: `Bearer ${m.token}`},
      payload: {...m.payload, overflow: "x".repeat(2048)},
    });
    expect(response.statusCode).toBe(413);
    expect(m.query).not.toHaveBeenCalled();
  });
});
