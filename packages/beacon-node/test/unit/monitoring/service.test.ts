import {describe, it, expect, beforeEach, beforeAll, afterAll, vi, afterEach, MockInstance} from "vitest";
import {Histogram} from "prom-client";
import {ErrorAborted, TimeoutError} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../../src/index.js";
import {MonitoringService} from "../../../src/monitoring/service.js";
import {MonitoringOptions} from "../../../src/monitoring/options.js";
import {sleep} from "../../utils/sleep.js";
import {MockedLogger, getMockedLogger} from "../../mocks/loggerMock.js";
import {startRemoteService, remoteServiceRoutes, remoteServiceError} from "./remoteService.js";

describe("monitoring / service", () => {
  const endpoint = "https://test.example.com/api/v1/client/metrics";

  let register: RegistryMetricCreator;
  let logger: MockedLogger;

  beforeEach(() => {
    // recreate to avoid "metric has already been registered" errors
    register = new RegistryMetricCreator();
    logger = getMockedLogger();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("MonitoringService - constructor", () => {
    let service: MonitoringService | undefined;

    afterEach(() => {
      service?.close();
    });

    it("should return an instance of the monitoring service", () => {
      service = new MonitoringService("beacon", {endpoint}, {register, logger});

      expect(service.close).toBeInstanceOf(Function);
      expect(service.send).toBeInstanceOf(Function);
    });

    it("should register metrics for collecting and sending data", () => {
      service = new MonitoringService("beacon", {endpoint}, {register, logger});

      expect(register.getSingleMetric("lodestar_monitoring_collect_data_seconds")).toBeInstanceOf(Histogram);
      expect(register.getSingleMetric("lodestar_monitoring_send_data_seconds")).toBeInstanceOf(Histogram);
    });

    it("should log a warning message if insecure monitoring endpoint is provided ", () => {
      const insecureEndpoint = "http://test.example.com/api/v1/client/metrics";

      service = new MonitoringService("beacon", {endpoint: insecureEndpoint}, {register, logger});

      expect(logger.warn).toHaveBeenCalledWith(
        "Insecure monitoring endpoint, please make sure to always use a HTTPS connection in production"
      );
    });

    it("should throw an error if monitoring endpoint is not provided", () => {
      const endpoint = "";
      expect(() => new MonitoringService("beacon", {endpoint}, {register, logger})).toThrow(
        `Monitoring endpoint is empty or undefined: ${endpoint}`
      );
    });

    it("should throw an error if monitoring endpoint is not a valid URL", () => {
      const endpoint = "invalid";
      expect(() => new MonitoringService("beacon", {endpoint}, {register, logger})).toThrow(
        `Monitoring endpoint must be a valid URL: ${endpoint}`
      );
    });

    it("should have the status set to started", async () => {
      const service = await stubbedMonitoringService();

      expect(service["status"]).toBe("started");
    });

    it("should set interval to continuously send client stats", async () => {
      const setTimeout = vi.spyOn(global, "setTimeout");
      const interval = 1000;

      const service = await stubbedMonitoringService({interval});

      expect(setTimeout).toHaveBeenCalledWith(expect.objectContaining({}), interval);
      expect(service["monitoringInterval"]).toBeInstanceOf(Object);
    });

    it("should send client stats after initial delay", async () => {
      const service = await stubbedMonitoringService();

      expect(service.send).toHaveBeenCalledTimes(1);
    });

    it("should send client stats after interval", async () => {
      const interval = 10;

      const service = await stubbedMonitoringService({interval});

      // wait for interval to be executed
      await sleep(interval);

      expect(service.send).toHaveBeenCalledTimes(2);
    });

    it("should log an info message that service was started", async () => {
      await stubbedMonitoringService();

      expect(logger.info).toHaveBeenCalledWith(
        "Started monitoring service",
        // TODO: Debug why `expect.any` causing type error
        expect.objectContaining({interval: expect.any(Number), machine: null, remote: expect.any(String)})
      );
    });
  });

  describe("MonitoringService - close", () => {
    let clearTimeout: MockInstance;

    beforeAll(() => {
      clearTimeout = vi.spyOn(global, "clearTimeout");
    });

    it("should set the status to closed", async () => {
      const service = await stubbedMonitoringService();

      service.close();

      expect(service["status"]).toBe("closed");
    });

    it("should clear the monitoring interval", async () => {
      const service = await stubbedMonitoringService();

      service.close();

      expect(clearTimeout).toHaveBeenCalledWith(service["monitoringInterval"]);
    });

    it("should clear the initial delay timeout", async () => {
      const service = await stubbedMonitoringService({initialDelay: 1000});

      service.close();

      expect(clearTimeout).toHaveBeenCalledWith(service["initialDelayTimeout"]);
    });

    it("should abort pending requests", async () => {
      const service = await stubbedMonitoringService();
      service["pendingRequest"] = Promise.resolve();

      service.close();

      expect(service["fetchAbortController"]?.abort).toHaveBeenCalledTimes(1);
    });
  });

  describe("MonitoringService - send", () => {
    let service: MonitoringService | undefined;
    let remoteServiceUrl: URL;
    let baseUrl: string;

    beforeAll(async () => {
      ({baseUrl: remoteServiceUrl} = await startRemoteService());
      // get base URL from origin to remove trailing slash
      baseUrl = remoteServiceUrl.origin;
    });

    afterEach(() => {
      service?.close();
    });

    for (const client of ["beacon", "validator"] as const) {
      it(`should collect and send ${client} stats to remote service`, async () => {
        const endpoint = `${baseUrl}${remoteServiceRoutes.success}`;
        service = new MonitoringService(client, {endpoint, collectSystemStats: true}, {register, logger});

        await service.send();

        // Validation of sent data happens inside the mocked remote service
        // which returns a 500 error if data does not match expected schema.
        // Fail test if warning was logged due to a 500 response.
        expect(logger.warn).not.toHaveBeenCalledWith("Failed to send client stats");
      });
    }

    it("should properly handle remote service errors", async () => {
      const endpoint = `${baseUrl}${remoteServiceRoutes.error}`;
      service = new MonitoringService("beacon", {endpoint, collectSystemStats: false}, {register, logger});

      await service.send();

      assertError({message: remoteServiceError.status});
    });

    it("should properly handle errors if remote service is unreachable", async () => {
      const differentPort = Number(remoteServiceUrl.port) - 1;
      const endpoint = `http://127.0.0.1:${differentPort}/`;
      service = new MonitoringService("beacon", {endpoint}, {register, logger});

      await service.send();

      assertError({message: `Request to ${endpoint} failed, reason: connect ECONNREFUSED ${new URL(endpoint).host}`});
    });

    it("should abort pending requests if timeout is reached", async () => {
      const endpoint = `${baseUrl}${remoteServiceRoutes.pending}`;
      service = new MonitoringService(
        "beacon",
        {endpoint, requestTimeout: 10, collectSystemStats: false},
        {register, logger}
      );

      await service.send();

      assertError({message: new TimeoutError("request").message});
    });

    it("should abort pending requests if monitoring service is closed", () =>
      new Promise<void>((done, error) => {
        const endpoint = `${baseUrl}${remoteServiceRoutes.pending}`;
        service = new MonitoringService("beacon", {endpoint, collectSystemStats: false}, {register, logger});

        void service.send().finally(() => {
          try {
            assertError({message: new ErrorAborted("request").message});
            done();
          } catch (e) {
            error(e);
          }
        });

        // wait for request to be sent before closing
        setTimeout(() => service?.close(), 10);
      }));

    function assertError(error: {message: string}): void {
      // errors are not thrown and need to be asserted based on the log
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to send client stats"),
        expect.objectContaining({reason: error.message})
      );
    }
  });

  async function stubbedMonitoringService(options: Partial<MonitoringOptions> = {}): Promise<MonitoringService> {
    const service = new MonitoringService(
      "beacon",
      {endpoint, initialDelay: 0, ...options},
      {register: new RegistryMetricCreator(), logger}
    );
    service["fetchAbortController"] = new AbortController();
    vi.spyOn(service["fetchAbortController"], "abort");
    vi.spyOn(service, "send").mockResolvedValue(undefined);

    // wait for initial monitoring interval
    await waitForInterval();

    afterAll(() => {
      service.close();
    });

    return service;
  }

  async function waitForInterval(): Promise<void> {
    // value of 0 seems to do the job
    await sleep(0);
  }
});
