import {Registry} from "prom-client";
import {ErrorAborted, ILogger, sleep, TimeoutError} from "@lodestar/utils";
import {defaultMonitoringOptions, MonitoringOptions} from "./options.js";
import {createClientStats} from "./clientStats.js";
import {ClientStats} from "./types.js";

type MonitoringData = Record<string, string | number | boolean>;

type RemoteServerError = {
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
  private readonly remoteHost: string;
  private readonly remoteServerUrl: URL;
  private readonly options: Required<MonitoringOptions>;
  private readonly register: Registry;
  private readonly logger: ILogger;

  private sendDataInterval?: NodeJS.Timer;
  private fetchAbortController?: AbortController;
  private pendingRequest?: Promise<void>;

  constructor(client: Client, options: MonitoringOptions, {register, logger}: {register: Registry; logger: ILogger}) {
    this.options = {...defaultMonitoringOptions, ...options};
    this.logger = logger;
    this.register = register;
    this.remoteServerUrl = this.parseMonitoringEndpoint(this.options.endpoint);
    this.remoteHost = this.remoteServerUrl.host;
    this.clientStats = createClientStats(client, this.options.collectSystemStats);
  }

  start(): void {
    if (this.sendDataInterval) {
      // monitoring service is already started
      return;
    }

    const {interval, initialDelay, requestTimeout, collectSystemStats} = this.options;

    sleep(initialDelay * 1000).finally(async () => {
      await this.sendData();

      this.sendDataInterval = setInterval(async () => {
        await this.sendData();
      }, interval * 1000);
    });

    this.logger.info("Started monitoring service", {
      remote: this.remoteHost,
      interval: `${interval}s`,
      initialDelay: `${initialDelay}s`,
      requestTimeout: `${requestTimeout}s`,
      collectSystemStats,
    });
  }

  stop(): void {
    if (this.sendDataInterval) {
      clearInterval(this.sendDataInterval);
      this.sendDataInterval = undefined;
    }
    if (this.pendingRequest) {
      this.fetchAbortController?.abort(FetchAbortReason.Stop);
    }
  }

  private async sendData(): Promise<void> {
    if (!this.pendingRequest) {
      this.pendingRequest = (async () => {
        try {
          const data = await this.collectData();

          const res = await this.fetchRemoteServerUrl(this.remoteServerUrl, data);

          if (!res.ok) {
            const error = (await res.json()) as RemoteServerError;
            throw new Error(error.status);
          }

          this.logger.debug(`Sent client stats to ${this.remoteHost}`, {data: JSON.stringify(data)});
        } catch (e) {
          this.logger.error(`Failed to send client stats to ${this.remoteHost}`, {}, e as Error);
        } finally {
          this.pendingRequest = undefined;
        }
      })();
    }

    await this.pendingRequest;
  }

  private async collectData(): Promise<MonitoringData[]> {
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

    await Promise.all(recordPromises);

    return data;
  }

  private async fetchRemoteServerUrl(url: URL, data: MonitoringData[]): Promise<Response> {
    this.fetchAbortController = new AbortController();

    const timeout = setTimeout(
      () => this.fetchAbortController?.abort(FetchAbortReason.Timeout),
      this.options.requestTimeout * 1000
    );

    try {
      return await fetch(url, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(data),
        signal: this.fetchAbortController.signal,
      });
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
