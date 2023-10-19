import {describe, it, afterAll} from "vitest";
import {fetch} from "@lodestar/api";
import {getHttpMetricsServer, HttpMetricsServer} from "../../../../src/metrics/index.js";
import {testLogger} from "../../../utils/logger.js";
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

  afterAll(async () => {
    if (server) await server.close();
  });
});
