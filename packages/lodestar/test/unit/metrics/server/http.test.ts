import request from "supertest";
import {Metrics, HttpMetricsServer} from "../../../../src/metrics";
import {testLogger} from "../../../utils/logger";

describe("HttpMetricsServer", () => {
  const logger = testLogger();

  let server: HttpMetricsServer;

  it("should serve metrics on /metrics", async () => {
    const options = {enabled: true, timeout: 5000, serverPort: 0, pushGateway: false};
    const metrics = new Metrics(options);
    server = new HttpMetricsServer(options, {metrics, logger});

    await server.start();
    await request(server.http).get("/metrics").expect(200);
  });

  after(async () => {
    await server.stop();
  });
});
