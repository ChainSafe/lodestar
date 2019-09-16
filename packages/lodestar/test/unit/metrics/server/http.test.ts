import request from "supertest";
import {Metrics, HttpMetricsServer} from "../../../../src/metrics";
import {ILogger, WinstonLogger} from "../../../../src/logger";
describe("HttpMetricsServer", () => {
  let logger: ILogger = new WinstonLogger();
  it("should serve metrics on /metrics", async () => {
    const options = {enabled: true, timeout: 5000, serverPort: 5000, pushGateway: false};
    let metrics = new Metrics(options);
    let server = new HttpMetricsServer(options, {metrics, logger});
    await metrics.start();
    await server.start();
    await request('localhost:5000')
      .get('/metrics')
      .expect(200);
    await server.stop();
    await metrics.stop();
  });
});
