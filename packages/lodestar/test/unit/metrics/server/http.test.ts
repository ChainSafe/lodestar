import request from "supertest";
import {HttpMetricsServer} from "../../../../src/metrics";
import {testLogger} from "../../../utils/logger";
import {createMetricsTest} from "../utils";

describe("HttpMetricsServer", () => {
  const logger = testLogger();

  let server: HttpMetricsServer | null = null;

  it("should serve metrics on /metrics", async () => {
    const metrics = createMetricsTest();
    server = new HttpMetricsServer({enabled: true, timeout: 5000, serverPort: 0}, {metrics, logger});

    await server.start();
    await request(server.http).get("/metrics").expect(200);
  });

  after(async () => {
    if (server) await server.stop();
  });
});
