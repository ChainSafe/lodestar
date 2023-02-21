import {expect} from "chai";
import sinon, {SinonSpy} from "sinon";
import {ErrorAborted, Logger, TimeoutError} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../../src/index.js";
import {HistogramExtra} from "../../../src/metrics/utils/histogram.js";
import {MonitoringService} from "../../../src/monitoring/service.js";
import {createStubbedLogger} from "../../utils/mocks/logger.js";
import {MonitoringOptions} from "../../../src/monitoring/options.js";
import {sleep} from "../../utils/sleep.js";
import {startRemoteService, remoteServiceRoutes, remoteServiceError} from "./remoteService.js";

describe("monitoring / service", () => {
  const sandbox = sinon.createSandbox();
  const endpoint = "https://test.example.com/api/v1/client/metrics";

  let register: RegistryMetricCreator;
  let logger: Logger;

  beforeEach(() => {
    // recreate to avoid "metric has already been registered" errors
    register = new RegistryMetricCreator();
    logger = createStubbedLogger();
  });

  after(() => {
    sandbox.restore();
  });

  describe("MonitoringService - constructor", () => {
    it("should return an instance of the monitoring service", () => {
      const service = new MonitoringService("beacon", {endpoint}, {register, logger});

      expect(service.start).to.be.a("function");
      expect(service.stop).to.be.a("function");
      expect(service.send).to.be.a("function");
    });

    it("should register metrics for collecting and sending data", () => {
      new MonitoringService("beacon", {endpoint}, {register, logger});

      expect(register.getSingleMetric("lodestar_monitoring_collect_data_seconds")).to.be.instanceOf(HistogramExtra);
      expect(register.getSingleMetric("lodestar_monitoring_send_data_seconds")).to.be.instanceOf(HistogramExtra);
    });

    it("should log a warning message if insecure monitoring endpoint is provided ", () => {
      const insecureEndpoint = "http://test.example.com/api/v1/client/metrics";

      new MonitoringService("beacon", {endpoint: insecureEndpoint}, {register, logger});

      expect(logger.warn).to.have.been.calledWith(
        "Insecure monitoring endpoint, please make sure to always use a HTTPS connection in production"
      );
    });

    it("should throw an error if monitoring endpoint is not provided", () => {
      expect(() => new MonitoringService("beacon", {endpoint: ""}, {register, logger})).to.throw(
        "Monitoring endpoint must be provided"
      );
    });

    it("should throw an error if monitoring endpoint is not a valid URL", () => {
      expect(() => new MonitoringService("beacon", {endpoint: "invalid"}, {register, logger})).to.throw(
        "Monitoring endpoint must be a valid URL"
      );
    });
  });

  describe("MonitoringService - start", () => {
    it("should set the status to started", async () => {
      const service = await startedMonitoringService();

      expect(service["status"]).to.equal("started");
    });

    it("should set interval to continuously send client stats", async () => {
      const setTimeout = sandbox.spy(global, "setTimeout");
      const interval = 1000;

      const service = await startedMonitoringService({interval});

      expect(setTimeout).to.have.been.calledWithMatch({}, interval);
      expect(service["monitoringInterval"]).to.be.an("object");
    });

    it("should send client stats after initial delay", async () => {
      const service = await startedMonitoringService();

      expect(service.send).to.have.been.calledOnce;
    });

    it("should send client stats after interval", async () => {
      const interval = 10;

      const service = await startedMonitoringService({interval});

      // wait for interval to be executed
      await sleep(interval);

      expect(service.send).to.have.been.calledTwice;
    });

    it("should log an info message that service was started", async () => {
      await startedMonitoringService();

      expect(logger.info).to.have.been.calledWith("Started monitoring service");
    });

    it("should not send client stats if service is already started", async () => {
      const service = await startedMonitoringService();

      // invoke start a second time
      service.start();
      await waitForStart();

      expect(service.send).to.have.been.calledOnce;
    });
  });

  describe("MonitoringService - stop", () => {
    let clearTimeout: SinonSpy;

    before(() => {
      clearTimeout = sandbox.spy(global, "clearTimeout");
    });

    it("should set the status to stopped", async () => {
      const service = await startedMonitoringService();

      service.stop();

      expect(service["status"]).to.equal("stopped");
    });

    it("should clear the monitoring interval", async () => {
      const service = await startedMonitoringService();

      service.stop();

      expect(clearTimeout).to.have.been.calledWith(service["monitoringInterval"]);
    });

    it("should clear the initial delay timeout", async () => {
      const service = await startedMonitoringService({initialDelay: 1000});

      service.stop();

      expect(clearTimeout).to.have.been.calledWith(service["initialDelayTimeout"]);
    });

    it("should abort pending requests", async () => {
      const service = await startedMonitoringService();
      service["pendingRequest"] = Promise.resolve();

      service.stop();

      expect(service["fetchAbortController"]?.abort).to.have.been.calledOnce;
    });
  });

  describe("MonitoringService - send", () => {
    let remoteServiceUrl: URL;
    let baseUrl: string;

    before(async () => {
      ({baseUrl: remoteServiceUrl} = await startRemoteService());
      // get base URL from origin to remove trailing slash
      baseUrl = remoteServiceUrl.origin;
    });

    (["beacon", "validator"] as const).forEach((client) => {
      it(`should collect and send ${client} stats to remote service`, async () => {
        const endpoint = `${baseUrl}${remoteServiceRoutes.success}`;
        const service = new MonitoringService(client, {endpoint, collectSystemStats: true}, {register, logger});

        await service.send();

        // Validation of sent data happens inside the mocked remote service
        // which returns a 500 error if data does not match expected schema.
        // Fail test if error was logged due to a 500 response.
        expect(logger.error).to.not.have.been.calledOnce;
      });
    });

    it("should properly handle remote service errors", async () => {
      const endpoint = `${baseUrl}${remoteServiceRoutes.error}`;
      const service = new MonitoringService("beacon", {endpoint, collectSystemStats: false}, {register, logger});

      await service.send();

      assertError({message: remoteServiceError.status});
    });

    it("should properly handle errors if remote service is unreachable", async () => {
      const differentPort = Number(remoteServiceUrl.port) - 1;
      const endpoint = `http://127.0.0.1:${differentPort}`;
      const service = new MonitoringService("beacon", {endpoint}, {register, logger});

      await service.send();

      assertError({name: "FetchError"});
    });

    it("should abort pending requests if timeout is reached", async () => {
      const endpoint = `${baseUrl}${remoteServiceRoutes.pending}`;
      const service = new MonitoringService(
        "beacon",
        {endpoint, requestTimeout: 10, collectSystemStats: false},
        {register, logger}
      );

      await service.send();

      assertError({message: new TimeoutError(`reached for request to ${remoteServiceUrl.host}`).message});
    });

    it("should abort pending requests if monitoring service is stopped", (done) => {
      const endpoint = `${baseUrl}${remoteServiceRoutes.pending}`;
      const service = new MonitoringService("beacon", {endpoint, collectSystemStats: false}, {register, logger});
      service.start();

      service.send().finally(() => {
        try {
          assertError({message: new ErrorAborted(`request to ${remoteServiceUrl.host}`).message});
          done();
        } catch (e) {
          done(e);
        }
      });

      // wait for request to be sent before stopping
      setTimeout(() => service.stop(), 10);
    });

    function assertError(error: {name?: string; message?: string}): void {
      expect(logger.error).to.have.been.calledOnce;
      // errors are not thrown and need to be asserted based on the error log
      expect(logger.error).to.have.been.calledWithMatch("Failed to send client stats", {}, error);
    }
  });

  function stubbedMonitoringService(options: Partial<MonitoringOptions> = {}): MonitoringService {
    const service = new MonitoringService(
      "beacon",
      {endpoint, initialDelay: 0, ...options},
      {register: new RegistryMetricCreator(), logger}
    );
    service.send = sandbox.stub();
    service["fetchAbortController"] = sandbox.createStubInstance(AbortController);

    return service;
  }

  async function startedMonitoringService(options: Partial<MonitoringOptions> = {}): Promise<MonitoringService> {
    const service = stubbedMonitoringService(options);
    service.start();

    // ensure start is finished
    await waitForStart();

    after(service.stop);

    return service;
  }

  async function waitForStart(): Promise<void> {
    // value of 0 seems to do the job
    await sleep(0);
  }
});
