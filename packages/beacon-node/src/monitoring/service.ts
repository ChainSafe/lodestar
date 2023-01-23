import {Registry} from "prom-client";
import {ErrorAborted, ILogger, sleep, TimeoutError} from "@lodestar/utils";
import {RegistryMetricCreator} from "../metrics/index.js";
import {HistogramExtra} from "../metrics/utils/histogram.js";
import {defaultMonitoringOptions, MonitoringOptions} from "./options.js";
import {createClientStats} from "./clientStats.js";
import {ClientStats} from "./types.js";

type MonitoringData = Record<string, string | number | boolean>;

type RemoteServiceError = {
  status: string;
  data: null;
};

enum FetchAbortReason {
  Stop = "stop",
  Timeout = "timeout",
}

export type Client = "beacon" | "validator";

/**
 * Service for sending clients stats to a remote service (e.g. beaconcha.in)
 */
export class MonitoringService {
  private readonly clientStats: ClientStats[];
  private readonly remoteServiceUrl: URL;
  private readonly remoteServiceHost: string;
  private readonly options: Required<MonitoringOptions>;
  private readonly register: Registry;
  private readonly logger: ILogger;

  private readonly collectDataMetric: HistogramExtra<string>;
  private readonly sendDataMetric: HistogramExtra<"status">;

  private monitoringInterval?: NodeJS.Timer;
  private fetchAbortController?: AbortController;
  private pendingRequest?: Promise<void>;

  constructor(
    client: Client,
    options: MonitoringOptions,
    {register, logger}: {register: RegistryMetricCreator; logger: ILogger}
  ) {
    this.options = {...defaultMonitoringOptions, ...options};
    this.logger = logger;
    this.register = register;
    this.remoteServiceUrl = this.parseMonitoringEndpoint(this.options.endpoint);
    this.remoteServiceHost = this.remoteServiceUrl.host;
    this.clientStats = createClientStats(client, this.options.collectSystemStats);

    this.collectDataMetric = register.histogram({
      name: "lodestar_monitoring_collect_data_seconds",
      help: "Time spent to collect monitoring data in seconds",
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 1],
    });

    this.sendDataMetric = register.histogram({
      name: "lodestar_monitoring_send_data_seconds",
      help: "Time spent to send monitoring data to remote service in seconds",
      labelNames: ["status"],
      buckets: [0.1, 0.5, 1, 10, this.options.requestTimeout],
    });
  }

  start(): void {
    if (this.monitoringInterval) {
      // monitoring service is already started
      return;
    }

    const {interval, initialDelay, requestTimeout, collectSystemStats} = this.options;

    sleep(initialDelay * 1000).finally(async () => {
      await this.executeMonitoring();

      this.monitoringInterval = setInterval(async () => {
        await this.executeMonitoring();
      }, interval * 1000);
    });

    this.logger.info("Started monitoring service", {
      remote: this.remoteServiceHost,
      interval: `${interval}s`,
      initialDelay: `${initialDelay}s`,
      requestTimeout: `${requestTimeout}s`,
      collectSystemStats,
    });
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    if (this.pendingRequest) {
      this.fetchAbortController?.abort(FetchAbortReason.Stop);
    }
  }

  private async executeMonitoring(): Promise<void> {
    if (!this.pendingRequest) {
      this.pendingRequest = (async () => {
        try {
          const data = await this.collectData();

          const res = await this.sendData(data);

          if (!res.ok) {
            const error = (await res.json()) as RemoteServiceError;
            throw new Error(error.status);
          }

          this.logger.debug(`Sent client stats to ${this.remoteServiceHost}`, {data: JSON.stringify(data)});
        } catch (e) {
          this.logger.error(`Failed to send client stats to ${this.remoteServiceHost}`, {}, e as Error);
        } finally {
          this.pendingRequest = undefined;
        }
      })();
    }

    await this.pendingRequest;
  }

  private async collectData(): Promise<MonitoringData[]> {
    const timer = this.collectDataMetric.startTimer();
    const data: MonitoringData[] = [];
    const recordPromises = [];

    for (const [i, s] of this.clientStats.entries()) {
      data[i] = {};

      recordPromises.push(
        ...Object.values(s).map(async (property) => {
          const record = await property.getRecord(this.register);
          data[i][record.key] = record.value;
        })
      );
    }

    await Promise.all(recordPromises).finally(timer);

    return data;
  }

  private async sendData(data: MonitoringData[]): Promise<Response> {
    const timer = this.sendDataMetric.startTimer();
    this.fetchAbortController = new AbortController();

    const timeout = setTimeout(
      () => this.fetchAbortController?.abort(FetchAbortReason.Timeout),
      this.options.requestTimeout * 1000
    );

    let res: Response | undefined;

    try {
      res = await fetch(this.remoteServiceUrl, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
        signal: this.fetchAbortController.signal,
      });

      return res;
    } catch (e) {
      const {signal} = this.fetchAbortController;

      if (signal.aborted) {
        if (signal.reason === FetchAbortReason.Stop) {
          throw new ErrorAborted("fetch");
        } else if (signal.reason === FetchAbortReason.Timeout) {
          throw new TimeoutError("fetch");
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    } finally {
      timer({status: res?.ok ? "success" : "error"});
      clearTimeout(timeout);
    }
  }

  private parseMonitoringEndpoint(endpoint: string): URL {
    if (!endpoint) {
      throw new Error("Monitoring endpoint must be provided");
    }

    try {
      const url = new URL(endpoint);

      if (url.protocol === "http:") {
        this.logger.warn(
          "Insecure monitoring endpoint, please make sure to always use a HTTPS connection in production"
        );
      } else if (url.protocol !== "https:") {
        throw new Error();
      }

      return url;
    } catch {
      throw new Error("Monitoring endpoint must be a valid URL");
    }
  }
}
