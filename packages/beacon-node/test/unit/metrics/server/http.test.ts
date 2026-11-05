import {afterEach, describe, expect, it} from "vitest";
import {testLogger} from "@lodestar/logger/test-utils";
import {fetch} from "@lodestar/utils";
import {HttpMetricsServer, getHttpMetricsServer} from "../../../../src/metrics/index.js";
import {createMetricsTest} from "../utils.js";

describe("HttpMetricsServer", () => {
  const logger = testLogger();

  let server: HttpMetricsServer | null = null;
  const port = 14500;

  it("should serve metrics on /metrics", async () => {
    const metrics = createMetricsTest();
    server = await getHttpMetricsServer({port}, {register: metrics.register, logger});

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    await res.text();
  });

  it("returns 500 when another metrics source rejects", async () => {
    const metrics = createMetricsTest();
    server = await getHttpMetricsServer(
      {port},
      {
        register: metrics.register,
        logger,
        getOtherMetrics: async () => {
          throw new Error("native scrape failed");
        },
      }
    );
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("native scrape failed");
  });

  afterEach(async () => {
    if (server) await server.close();
  });
});
