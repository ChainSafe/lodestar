import {Registry} from "prom-client";
import {fetch} from "@lodestar/api";
import {ErrorAborted, Histogram, Logger, TimeoutError} from "@lodestar/utils";
import {RegistryMetricCreator} from "../metrics/index.js";
import {defaultMonitoringOptions, MonitoringOptions} from "./options.js";
import {createClientStats} from "./clientStats.js";
import {ClientStats} from "./types.js";
import system from "./system.js";

type MonitoringData = Record<string, string | number | boolean>;

export type RemoteServiceError = {
  status: string;
  data: null;
};

enum FetchAbortReason {
  Close = "close",
  Timeout = "timeout",
}

enum Status {
  Started = "started",
  Closed = "closed",
}

enum SendDataStatus {
  Success = "success",
  Error = "error",
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
  private readonly logger: Logger;

  private readonly collectDataMetric: Histogram;
  private readonly sendDataMetric: Histogram<{status: SendDataStatus}>;

  private status = Status.Started;
  private initialDelayTimeout?: NodeJS.Timeout;
  private monitoringInterval?: NodeJS.Timeout;
  private fetchAbortController?: AbortController;
  private pendingRequest?: Promise<void>;

  constructor(
    client: Client,
    options: Required<Pick<MonitoringOptions, "endpoint">> & MonitoringOptions,
    {register, logger}: {register: RegistryMetricCreator; logger: Logger}
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
      buckets: [0.001, 0.01, 0.1, 1, 5],
    });

    this.sendDataMetric = register.histogram({
      name: "lodestar_monitoring_send_data_seconds",
      help: "Time spent to send monitoring data to remote service in seconds",
      labelNames: ["status"],
      buckets: [0.3, 0.5, 1, Math.floor(this.options.requestTimeout / 1000)],
    });

    this.initialDelayTimeout = setTimeout(async () => {
      await this.send();
      this.nextMonitoringInterval();
    }, this.options.initialDelay);

    this.logger.info("Started monitoring service", {
      // do not log full URL as it may contain secrets
      remote: this.remoteServiceHost,
      machine: this.remoteServiceUrl.searchParams.get("machine"),
      interval: this.options.interval,
    });
  }

  /**
   * Stop sending client stats
   */
  close(): void {
    if (this.status === Status.Closed) return;
    this.status = Status.Closed;

    if (this.initialDelayTimeout) {
      clearTimeout(this.initialDelayTimeout);
    }
    if (this.monitoringInterval) {
      clearTimeout(this.monitoringInterval);
    }
    if (this.pendingRequest) {
      this.fetchAbortController?.abort(FetchAbortReason.Close);
    }
  }

  /**
   * Collect and send client stats
   */
  async send(): Promise<void> {
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
          this.logger.warn(`Failed to send client stats to ${this.remoteServiceHost}`, {reason: (e as Error).message});
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

    if (this.options.collectSystemStats) {
      await system.collectData(this.logger);
    }

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
      this.options.requestTimeout
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

      if (!signal.aborted) {
        // error was thrown by fetch
        throw e;
      }

      // error was thrown by abort signal
      if (signal.reason === FetchAbortReason.Close) {
        throw new ErrorAborted("request");
      }
      if (signal.reason === FetchAbortReason.Timeout) {
        throw new TimeoutError("request");
      }
      throw e;
    } finally {
      timer({status: res?.ok ? SendDataStatus.Success : SendDataStatus.Error});
      clearTimeout(timeout);
    }
  }

  private nextMonitoringInterval(): void {
    if (this.status === Status.Closed) return;
    // ensure next interval only starts after previous request has finished
    // else we might send next request too early and run into rate limit errors
    this.monitoringInterval = setTimeout(async () => {
      await this.send();
      this.nextMonitoringInterval();
    }, this.options.interval);
  }

  private parseMonitoringEndpoint(endpoint: string): URL {
    if (!endpoint) {
      throw new Error(`Monitoring endpoint is empty or undefined: ${endpoint}`);
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
    } catch (_e) {
      throw new Error(`Monitoring endpoint must be a valid URL: ${endpoint}`);
    }
  }
}
