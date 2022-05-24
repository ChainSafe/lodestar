import request from "supertest";
import {HttpMetricsServer} from "../../../../src/metrics/index.js";
import {testLogger} from "../../../utils/logger.js";
import {createMetricsTest} from "../utils.js";

describe("HttpMetricsServer", () => {
  const logger = testLogger();

  let server: HttpMetricsServer | null = null;

  it("should serve metrics on /metrics", async () => {
    const metrics = createMetricsTest();
    server = new HttpMetricsServer({port: 0}, {register: metrics.register, logger});

    await server.start();
    await request(server["server"]).get("/metrics").expect(200);
  });

  after(async () => {
    if (server) await server.stop();
  });
});
