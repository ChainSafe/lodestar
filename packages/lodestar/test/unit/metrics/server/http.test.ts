import request from "supertest";
import {Metrics, HttpMetricsServer} from "../../../../src/metrics";
import {ILogger, Logger} from "@chainsafe/lodestar-utils";
describe("HttpMetricsServer", () => {
  const logger: ILogger = new Logger();
  it("should serve metrics on /metrics", async () => {
    const options = {enabled: true, timeout: 5000, serverPort: 0, pushGateway: false};
    const metrics = new Metrics(options);
    const server = new HttpMetricsServer(options, {metrics, logger});
    await server.start();
    await request(server.http).get("/metrics").expect(200);
    await server.stop();
    metrics.close();
  });
});
