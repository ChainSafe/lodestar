import request from "supertest";
import {Metrics, HttpMetricsServer} from "../../../../src/metrics";

describe("HttpMetricsServer", () => {
  it("should serve metrics on /metrics", async () => {
    const options = {enabled: true, timeout: 5000, serverPort: 5000, pushGateway: false};
    let metrics = new Metrics(options);
    let server = new HttpMetricsServer(options, {metrics});
    await metrics.start();
    await server.start();
    await request('localhost:5000')
      .get('/metrics')
      .expect(200);
    await server.stop();
    await metrics.stop();
  });
});
